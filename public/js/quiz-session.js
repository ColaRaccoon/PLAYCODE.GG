// js/quiz-session.js

import { renderNavbar, getUserData, highlightCurrentPage } from './navbar.js';
import { initializeComments } from './quiz-comments.js';
import {
  getGuestNickname,
  setGuestNickname,
  getGuestId,
  setGuestId,
  showNicknameModal
} from './guestNicknameHelper.js';

// 전역 변수들
let currentSendFunction = sendMessage;
let questions = [];
let quizData = null;
let currentIndex = 0;
let questionTimer = null;
let nextQuestionTimer = null; // 정답 공개 후 5초 타이머
let currentRevealedAt = null; // 정답 공개 시간
let host = null;
let questionStartAt = null;
let countdownInterval = null;
let hasAnswered = false;
let sessionData = null;
let isDataLoaded = false;
let isCodeVisible = false;
let actualInviteCode = '';
let currentWaitingSendFunction = sendWaitingMessage;
let youtubePlayer = null;
let globalYoutubeVolume = 50;
let questionOrder = [];
let correctUsersThisQuestion = new Set(); // 현재 문제에서 정답 맞춘 사용자 닉네임

const sessionId = window.location.pathname.split('/').pop();
let userId = null;
let isGuest = false;
let guestNickname = null;
let cachedUserData = null; // 사용자 정보 캐시

// Socket.IO 연결은 나중에 초기화 (게스트/로그인 사용자 구분 후)
let socket = null;

// ========== 🛡️ 소켓 이벤트 보호 (콘솔 직접 호출 차단) ==========
// Socket 초기화 후 호출되어야 함
function protectSocketEvents() {
  if (!socket) return;

  const protectedEvents = ['correct', 'choiceQuestionCorrect', 'choiceQuestionIncorrect'];
  const originalEmit = socket.emit.bind(socket);
  const internalToken = Symbol('internal'); // 외부에서 접근 불가

  // socket.emit 오버라이드
  socket.emit = function(event, ...args) {
    // 보호된 이벤트를 직접 호출하려고 시도하는 경우
    if (protectedEvents.includes(event)) {
      // 내부 토큰이 없으면 차단
      if (args[args.length - 1] !== internalToken) {
        return;
      }
      // 내부 토큰 제거 후 실제 emit
      args.pop();
    }
    return originalEmit(event, ...args);
  };

  // 내부 전용 emit 함수 (클로저로 internalToken 보호)
  window.__protectedEmit = function(event, data) {
    return originalEmit(event, data, internalToken);
  };
}

// 🛡️ 정답 해시화 함수 (서버와 동일한 방식)
function hashAnswer(answer) {
  // 정답을 정규화: 공백 제거 + 소문자 변환
  const normalized = answer.replace(/\s+/g, '').toLowerCase();
  return CryptoJS.SHA256(normalized).toString();
}

// 인증 확인 함수 (게스트도 허용)
async function fetchWithAuth(url, options = {}) {
    options.credentials = 'include';
    let response = await fetch(url, options);

    if (response.status === 401) {
        const refreshResponse = await fetch('/auth/refresh', {
            method: 'POST',
            credentials: 'include'
        });

        if (refreshResponse.ok) {
            response = await fetch(url, options);
        } else {
            // 게스트는 로그인 페이지로 리다이렉트하지 않음
            // 401 응답을 그대로 반환
        }
    }
    return response;
}

// 캐시된 사용자 정보 가져오기
async function getCachedUserData() {
    if (cachedUserData) {
        return cachedUserData;
    }
    cachedUserData = await getUserData();
    return cachedUserData;
}

// 사용자 정보 가져오기 및 소켓 연결 (게스트 지원)
async function initializeUser() {
    try {
        const response = await fetchWithAuth('/my-info');

        if (response && response.ok) {
            // 로그인한 사용자
            const userData = await response.json();
            userId = userData._id;
            isGuest = false;

            // Socket.IO 연결 (로그인 사용자)
            socket = io({
              withCredentials: true,
              transports: ['websocket', 'polling'],
              reconnection: true,
              reconnectionAttempts: 5,
              reconnectionDelay: 1000
            });

            setupSocketListeners();
            protectSocketEvents();

            // userId 설정 완료 후 joinSession
            if (socket.connected) {
                socket.emit('joinSession', { sessionId });
            }
        } else {
            // 게스트 사용자
            await initializeGuest();
        }
    } catch (error) {
        console.error('Error fetching user info:', error);
        // 에러 발생 시 게스트로 처리
        await initializeGuest();
    }
}

// 게스트 사용자 초기화
async function initializeGuest() {
    isGuest = true;

    // 로컬스토리지에서 닉네임 가져오기
    let savedNickname = getGuestNickname();
    let savedGuestId = getGuestId();

    // 닉네임이 없으면 모달 표시
    if (!savedNickname) {
        savedNickname = await showNicknameModal();
        setGuestNickname(savedNickname);
    }

    guestNickname = savedNickname;

    // 게스트 ID가 없으면 생성
    if (!savedGuestId) {
        savedGuestId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        setGuestId(savedGuestId);
    }

    userId = savedGuestId;

    // Socket.IO 연결 (게스트)
    socket = io({
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      query: {
        guestId: userId,
        guestNickname: guestNickname
      }
    });

    setupSocketListeners();
    protectSocketEvents();

    // userId 설정 완료 후 joinSession
    if (socket.connected) {
        socket.emit('joinSession', { sessionId });
    }
}

// 호스트 여부 확인
function isHost() {
    return userId === host;
}

// 세션 데이터 로딩
async function loadSessionData() {
    try {
        const res = await fetchWithAuth(`/game/session/${sessionId}`);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || '세션 정보를 불러오는데 실패했습니다.');
        }
        
        const data = await res.json();

        const profileImageLog = data.players.map(player => {
            return {
                nickname: player.nickname,
                hasImage: !!player.profileImage,
                imageType: player.profileImage ? 
                    (player.profileImage.startsWith('data:') ? 'Base64' : 'URL') : 'None',
                imagePreview: player.profileImage ? player.profileImage.substring(0, 50) + '...' : null
            };
        });
        
        if (!data || !data.quiz || !Array.isArray(data.players)) {
            throw new Error('세션 데이터가 유효하지 않습니다.');
        }

        sessionData = data;
        currentIndex = data.currentQuestionIndex;
        questionStartAt = new Date(data.questionStartAt);
        host = data.host;

        // questionOrder 설정 (서버에서 온 순서 또는 기본 순서)
        questionOrder = data.questionOrder || Array.from({ length: data.quiz.questions.length }, (_, i) => i);

        // ⚠️ questions 배열이 이미 존재하면 덮어쓰지 않음 (game-started 이벤트에서 해시된 데이터 사용 중)
        if (questions && questions.length > 0) {
            // questions 배열이 이미 존재하면 덮어쓰지 않음 (해시 데이터 보존)
        } else {
            // 🛡️ 서버에서 이미 choices를 만들어서 보낸 경우 그대로 사용
            questions = data.quiz.questions.map(question => {
            // 이미 choices가 있으면 (서버에서 만든 경우) 그대로 사용
            if (question.choices && question.choices.length > 0) {
                return {
                    ...question,
                    isChoice: true
                };
            }

            // 하위 호환성: 기존 방식 (incorrectAnswers로 choices 생성)
            if (question.incorrectAnswers && question.incorrectAnswers.length > 0) {
                // 정답 + 오답 섞기
                const allChoices = [...question.answers, ...question.incorrectAnswers];

                // Fisher-Yates 셔플
                for (let i = allChoices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]];
                }

                return {
                    ...question,
                    isChoice: true,
                    choices: allChoices
                };
            }

            return {
                ...question,
                isChoice: false
            };
        });
        }

        // 퀴즈 정보 표시
        displayQuizInfo(data.quiz);
        
       if (data.inviteCode) {
            setInviteCode(data.inviteCode);
        } else {
            document.getElementById('inviteCodeDisplay').textContent = '없음';
        }

        // 스킵 상태 렌더링
        renderSkipStatus(data.skipVotes?.length || 0, data.players?.length || 0);
        
        if (data.isStarted) {
            showGameSection();

            if (data.revealedAt) {
                showQuestion({ silent: true });
                renderScoreboard(data.players, false);

                // ✅ actualIndex 정의
                const actualIndex = questionOrder[currentIndex];

                // 힌트 숨기기
                const hintDisplay = document.getElementById('hintDisplay');
                if (hintDisplay) {
                    hintDisplay.classList.add('hidden');
                }

                // ✅ questions 배열과 actualIndex 유효성 체크
                if (questions && questions[actualIndex]) {
                    const answers = questions[actualIndex].answers;
                    if (answers) {
                        const displayAnswer = Array.isArray(answers) ? answers[0] : answers;
                        const answerDiv = document.createElement('div');
                        answerDiv.className = 'answer-reveal';
                        answerDiv.innerHTML = `<h3>정답 공개</h3><p>${displayAnswer}</p>`;
                        document.getElementById('questionBox').appendChild(answerDiv);
                    }

                    const answerImage = questions[actualIndex]?.answerImageBase64;
                    if (answerImage) {
                        const img = document.createElement('img');
                        img.src = answerImage;
                        img.alt = '정답 이미지';
                        img.className = 'question-image';
                        document.getElementById('questionBox').appendChild(img);
                    }
                }

                window.__isRevealingAnswer = true;
                currentRevealedAt = new Date(data.revealedAt);

                // ✅ 타이머가 이미 실행 중이면 새로 만들지 않음 (중복 방지)
                if (!nextQuestionTimer) {
                    const elapsed = (Date.now() - currentRevealedAt.getTime()) / 1000;
                    const remainingTime = Math.max(0, Math.min(5, 5 - elapsed)) * 1000;
                    // ✅ currentIndex 클로저 캡처
                    const questionIndexAtReveal = currentIndex;

                    nextQuestionTimer = setTimeout(() => {
                        window.__isRevealingAnswer = false;
                        currentRevealedAt = null;
                        nextQuestionTimer = null;
                        if (isHost()) {
                            socket.emit('nextQuestion', {
                                sessionId,
                                userId,
                                questionIndex: questionIndexAtReveal
                            });
                        }
                    }, remainingTime);
                }
            } else {
                // 정답 공개 중이 아닌 경우 - 문제를 표시하되 타이머는 시작하지 않음 (서버에서 question-start 이벤트를 기다림)
                showQuestion({ silent: true });
                renderScoreboard(data.players, false);

                // 서버에 준비 완료 신호 전송
                socket.emit('client-ready', { sessionId });
            }
        } else {
            showQuizInfoSection();
        }

        // 댓글 초기화는 join-success 이벤트에서 처리됨 (중복 방지)

    } catch (err) {
        console.error('세션 로딩 실패:', err);
        if (err.message === '세션 없음') {
            location.href = '/';
        } else {
            alert(err.message || '세션 정보를 불러오는 중 오류가 발생했습니다.');
            location.href = '/';
        }
    }
}

// 퀴즈 정보 표시
function displayQuizInfo(quiz) {
    document.getElementById('quizTitle').textContent = quiz.title;
    document.getElementById('quizDescription').textContent = quiz.description || '이 퀴즈에 도전해보세요!';
    document.getElementById('totalQuestions').textContent = quiz.questions.length;

    // 썸네일 이미지 표시
    const thumbnailContainer = document.getElementById('quizThumbnail');
    const defaultThumbnail = document.getElementById('defaultThumbnail');

    if (quiz.titleImageBase64) {
        // 기본 Q 텍스트 숨기기
        if (defaultThumbnail) {
            defaultThumbnail.style.display = 'none';
        }

        // 기존 이미지가 있는지 확인
        let imgElement = thumbnailContainer.querySelector('img:not(#recommendIcon)');
        if (!imgElement) {
            // 이미지가 없으면 새로 생성
            imgElement = document.createElement('img');
            imgElement.className = 'absolute inset-0 w-full h-full object-cover';
            imgElement.alt = quiz.title;
            // 컨테이너에 추가 (추천 버튼보다 먼저 배치)
            thumbnailContainer.insertBefore(imgElement, thumbnailContainer.firstChild);
        }
        imgElement.src = quiz.titleImageBase64;
    }

    // 초대코드 표시 및 버튼 활성화
    const inviteCodeDisplay = document.getElementById('inviteCodeDisplay');
    const copyBtn = document.getElementById('copyInviteBtn');

    if (sessionData && sessionData.inviteCode) {
        inviteCodeDisplay.textContent = sessionData.inviteCode;
        copyBtn.disabled = false;
        copyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    // 추천 버튼 표시 및 상태 설정
    const recommendSection = document.getElementById('recommendSection');
    const recommendBtn = document.getElementById('recommendBtn');
    const recommendIcon = document.getElementById('recommendIcon');
    const recommendCount = document.getElementById('recommendCount');

    if (recommendSection && recommendBtn) {
        // 추천 버튼 표시
        recommendSection.classList.remove('hidden');

        // 추천 수 표시
        recommendCount.textContent = quiz.recommendationCount || 0;

        // 추천 상태에 따라 아이콘 변경
        if (quiz.hasRecommended) {
            recommendIcon.src = '/images/Thumbsup2.png';
        } else {
            recommendIcon.src = '/images/Thumbsup1.png';
        }

        // 추천 버튼 클릭 이벤트 (이벤트 리스너는 setupEventListeners에서 설정)
    }

    // 제작자 정보 표시
    displayCreatorInfo(quiz);
}

// 제작자 정보 표시 함수
function displayCreatorInfo(quiz) {
    const creatorSection = document.getElementById('creatorSection');
    const creatorNickname = document.getElementById('creatorNickname');
    const endCreatorNickname = document.getElementById('endCreatorNickname');

    if (!creatorSection || !creatorNickname) return;

    // 서버에서 받은 제작자 닉네임 사용
    const nickname = quiz.creatorNickname || '알 수 없음';

    // 대기 화면에 표시
    creatorNickname.textContent = nickname;
    creatorSection.classList.remove('hidden');

    // 종료 화면에도 저장 (나중에 사용)
    if (endCreatorNickname) {
        endCreatorNickname.textContent = nickname;
    }
}

// 퀴즈 정보 섹션 표시
function showQuizInfoSection() {
    document.getElementById('quizInfoSection').classList.remove('hidden');
    document.getElementById('gameSection').classList.add('hidden');
    
    // 데스크톱 버튼 숨기기
    document.getElementById('voteSkipBtn').classList.add('hidden');
    document.getElementById('forceSkipBtn').classList.add('hidden');
    
    // 모바일 버튼 숨기기
    document.getElementById('voteSkipBtnMobile').classList.add('hidden');
    document.getElementById('forceSkipBtnMobile').classList.add('hidden');
    
    document.getElementById('skipStatus').classList.add('hidden');
}

// 게임 섹션 표시
function showGameSection() {
    document.getElementById('quizInfoSection').classList.add('hidden');
    document.getElementById('gameSection').classList.remove('hidden');
    
    // 데스크톱 스킵투표 버튼 표시
    document.getElementById('voteSkipBtn').classList.remove('hidden');
    
    // 모바일 스킵투표 버튼 표시
    document.getElementById('voteSkipBtnMobile').classList.remove('hidden');
    
    document.getElementById('skipStatus').classList.remove('hidden');
    
    // 호스트인 경우 강제스킵 버튼 표시
    if (userId === host) {
        document.getElementById('forceSkipBtn').classList.remove('hidden');
        document.getElementById('forceSkipBtnMobile').classList.remove('hidden');
    }
}

// 점수판 렌더링
function renderScoreboard(players) {
    const board = document.getElementById('scoreboard');
    board.innerHTML = '';

    // 게임 중에는 점수가 있는 모든 플레이어 표시 (connected 상태 무관)
    const sortedPlayers = players
        .slice()
        .sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((p, index) => {
        const li = document.createElement('li');
        const displayName = p.nickname || 'Unknown';

        // 현재 문제에서 정답 맞춘 사용자는 초록색 테두리, 아니면 파란색
        const borderColor = correctUsersThisQuestion.has(displayName) ? 'border-green-500' : 'border-blue-400';

        // 접속 해제된 플레이어는 투명도 적용
        const opacityClass = p.connected === false ? 'opacity-50' : '';

        li.className = `flex-shrink-0 w-[85px] sm:w-[140px] h-full sm:h-auto p-2 sm:p-3 bg-gray-700/50 rounded-lg border-l-4 ${borderColor} ${opacityClass} flex flex-col justify-center sm:block`;
        li.setAttribute('data-nickname', displayName); // 닉네임 저장

        const avatarHTML = createPlayerAvatar(p);

        li.innerHTML = `
            <div class="flex items-center justify-center gap-1.5 sm:gap-3 mb-1.5 sm:mb-2">
                <span class="text-yellow-400 font-bold text-[10px] sm:text-sm">#${index + 1}</span>
                <div class="hidden sm:block">${avatarHTML}</div>
            </div>
            <div class="text-center">
                <div class="text-white font-medium text-[10px] sm:text-sm truncate mb-0.5 sm:mb-1">${displayName}${p.connected === false ? ' (접속 끊김)' : ''}</div>
                <div class="text-green-400 font-bold text-[10px] sm:text-lg">${p.score}점</div>
                <div class="text-gray-400 text-[10px] sm:text-xs">${p.correctAnswersCount || 0}문제</div>
            </div>
        `;
        board.appendChild(li);
    });

}

function updateQuestionNumber() {
    const questionNumberElement = document.getElementById('currentQuestionNumber');
    if (questionNumberElement && questions && questions.length > 0) {
        const current = currentIndex + 1;
        const total = questions.length;
        questionNumberElement.textContent = `문제 ${current} / ${total}`;
    }
}


// 참가자 목록 렌더링
function renderPlayerList(players) {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';

    const connectedPlayers = players.filter(p => p.connected);
    
    connectedPlayers.forEach(player => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between p-3 bg-gray-700/50 rounded-lg hover:bg-gray-600/50 transition-colors';
        
        // 프로필 이미지 또는 이니셜 아바타 생성
        const avatarHTML = createPlayerAvatar(player);
        
        const displayName = player.nickname || 'Unknown';
        
        li.innerHTML = `
            <div class="flex items-center space-x-3">
                ${avatarHTML}
                <span class="text-white font-medium">${displayName}</span>
            </div>
        `;

        playerList.appendChild(li);
    });

    // 참가자 수 업데이트
    const totalCountElement = document.getElementById('totalPlayerCount');
    if (totalCountElement) {
        totalCountElement.textContent = connectedPlayers.length;
    }
    
    // 스크롤 힌트 표시/숨김
    const scrollHint = document.getElementById('scrollHint');
    const playerListContainer = document.querySelector('.max-h-64');
    
    if (scrollHint && playerListContainer) {
        const containerHeight = playerListContainer.clientHeight;
        const contentHeight = playerListContainer.scrollHeight;
        
        if (contentHeight > containerHeight) {
            scrollHint.classList.remove('hidden');
        } else {
            scrollHint.classList.add('hidden');
        }
    }

    // 대기실 볼륨 슬라이더에 저장된 값 적용
    const waitingVolumeSlider = document.getElementById('waitingVolumeSlider');
    const waitingVolumePercent = document.getElementById('waitingVolumePercent');
    
    if (waitingVolumeSlider) {
        waitingVolumeSlider.value = globalYoutubeVolume;
    }
    if (waitingVolumePercent) {
        waitingVolumePercent.textContent = `${globalYoutubeVolume}%`;
    }
}

// 플레이어 아바타 생성 함수
function createPlayerAvatar(player) {
    const displayName = player.nickname || 'Unknown';
    const initial = displayName.charAt(0).toUpperCase();

    // 프로필 이미지가 있고 네이버 기본 이미지가 아닌 경우
    if (player.profileImage &&
        player.profileImage !== 'https://ssl.pstatic.net/static/pwe/address/img_profile.png' &&
        player.profileImage.trim() !== '') {

        return `
            <div class="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0">
                <img
                    src="${player.profileImage}"
                    alt="${displayName}님의 프로필"
                    class="w-full h-full object-cover"
                    onerror="console.log('⌧ 이미지 로딩 실패:', '${player.profileImage.substring(0, 30)}...'); this.style.display='none'; this.nextElementSibling.style.display='flex';"
                >
                <div class="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm" style="display: none;">
                    ${initial}
                </div>
            </div>
        `;
    } else {
        // 기본 이니셜 아바타
        return `
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                ${initial}
            </div>
        `;
    }
}

// 스킵 투표 상태 렌더링
function renderSkipStatus(voted, total) {
    document.getElementById('skipStatus').querySelector('span').textContent = `스킵 투표: ${voted} / ${total}`;
}

// 채팅 기록 불러오기 기능 제거됨 - 새로고침 시 채팅 초기화

// 일반 메시지 전송
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    input.value = '';

    if (!message) {
        return;
    }

    const actualIndex = questionOrder[currentIndex];

    // ✅ questions 배열 유효성 체크 (재접속 시 타이밍 이슈 방지)
    if (!questions || !questions[actualIndex]) {
        return;
    }

    // 🛡️ 클라이언트에서 먼저 정답 여부 확인 (해시 비교)
    const isCorrect = (function() {
        const hashedAnswers = questions[actualIndex].answers || []; // 서버에서 해시된 정답
        const userInputHash = hashAnswer(message); // 사용자 입력을 해시화

        return hashedAnswers.includes(userInputHash);
    })();

    if (!window.__isRevealingAnswer && isCorrect) {
        // ✅ 정답: 서버로 평문 전송하여 재검증
        window.__protectedEmit('correct', {
            sessionId,
            questionIndex: actualIndex,
            answer: message // 정답 평문 전송 (서버에서 재검증)
        });
    } else {
        // ❌ 오답: 채팅으로 전송 (다른 사람들이 볼 수 있음)
        socket.emit('chatMessage', { sessionId, message });
    }
}

// 객관식 문제 메시지 전송
function choiceQuestionSendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    input.value = '';

    if (!message) return;

    // 1~5 숫자 입력 시 자동으로 해당 선택지 선택
    const choiceNumber = parseInt(message);

    if (choiceNumber >= 1 && choiceNumber <= 5 && message === String(choiceNumber)) {
        // 현재 문제의 선택지 가져오기
        const actualIndex = questionOrder[currentIndex];

        // ✅ questions 배열 유효성 체크 (재접속 시 타이밍 이슈 방지)
        if (!questions || !questions[actualIndex]) {
            return;
        }

        const question = questions[actualIndex];

        if (question && question.choices && question.choices.length >= choiceNumber) {
            // 숫자에 해당하는 선택지 선택 (1-based index를 0-based로 변환)
            const selectedChoice = question.choices[choiceNumber - 1];
            selectChoice(selectedChoice);
            return; // 채팅으로 전송하지 않음
        }
    }

    // 숫자가 아니거나 유효하지 않은 번호면 일반 채팅으로 전송
    socket.emit('chatMessage', { sessionId, message });
}

// 문제 표시
function showQuestion({ silent = false } = {}) {
    const box = document.getElementById('questionBox');
    const actualIndex = questionOrder[currentIndex];
    const question = questions[actualIndex];
    const answers = questions[actualIndex]?.answers;

    if (!question) {
        console.error('문제를 찾을 수 없습니다:', currentIndex);
        return;
    }

    box.innerHTML = '';
    hasAnswered = false;

    // 다음 문제 시작 - 정답자 초기화 및 스코어보드 테두리 초기화
    correctUsersThisQuestion.clear();
    const allScoreboardItems = document.querySelectorAll('#scoreboard li');
    allScoreboardItems.forEach(item => {
        item.classList.remove('border-green-500');
        item.classList.add('border-blue-400');
    });

    let html = '';
    updateQuestionNumber();
    
    // 문제 타입 확인
    const questionType = question.questionType || 'text';
    
    // ========== 이미지 문제 (기존 로직 유지) ==========
    if (question.imageBase64) {
        html += `<img src="${question.imageBase64}" alt="문제 이미지" class="w-auto h-auto max-h-[300px] mx-auto rounded-lg shadow-lg my-4">`;
    }

    // ========== YouTube 비디오 처리 (YouTube API 사용) ==========
    if (question.youtubeUrl) {
        const videoId = extractYoutubeVideoId(question.youtubeUrl);
        const startTime = question.youtubeStartTime || 0;
        const endTime = question.youtubeEndTime || 0;
        
        if (videoId) {
            // 영상 문제 (video) - YouTube API 사용
            if (questionType === 'video') {
                html += `
                    <div class="youtube-player-wrapper max-w-2xl mx-auto my-3 relative">
                        <div class="relative" style="padding-bottom: 56.25%; height: 0;">
                            <!-- YouTube 플레이어가 여기에 생성됨 -->
                            <div id="youtubePlayerVideo" class="absolute top-0 left-0 w-full h-full rounded-lg" style="pointer-events: none;"></div>
                            
                            <!-- 제목 가리는 검은색 오버레이 + 볼륨 컨트롤 -->
                            <div class="absolute top-0 left-0 w-full h-16 bg-black flex items-center justify-end px-4 rounded-t-lg z-10">
                                <div class="flex items-center gap-3">
                                    <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                                    </svg>
                                    <input 
                                        type="range" 
                                        id="youtubeVolumeSlider"
                                        class="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white" 
                                        min="0" 
                                        max="100" 
                                        value="${globalYoutubeVolume}"
                                        oninput="setYoutubeVolume(this.value)"
                                        style="pointer-events: auto;"
                                    >
                                    <span id="volumePercent" class="text-white font-medium text-sm min-w-[45px]">${globalYoutubeVolume}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
                // DOM 업데이트 후 플레이어 생성
                box.innerHTML = html;
                
                // 객관식/주관식 문제 UI 추가
                if (question.isChoice && question.choices && question.choices.length > 0) {
                    currentSendFunction = choiceQuestionSendMessage;
                    html = `<div class="text-gray-200 mb-1">${question.text}</div>`;
                    html += `<div class="grid grid-cols-2 md:grid-cols-3 gap-1 justify-items-center w-full max-w-[660px] mx-auto px-4">`;
                    
                    question.choices.forEach((choice, index) => {
                        const keyNumber = index + 1;
                        html += `
                            <button                          
                            onclick="selectChoice('${choice}')"
                            data-choice-index="${index}"
                            class="choice-btn w-full max-w-[200px] min-h-[20px] lg:max-h-[52px] hover:bg-blue-600 border-2 border-gray-600 text-white py-2 px-4 rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg text-[14px] disabled:transform-none break-words leading-tight relative"                     
                            >
                            <span class="absolute top-1 left-2 text-xs text-gray-400 font-bold">${keyNumber}</span>
                            ${choice}
                            </button>
                        `;
                    });
                    html += `</div>`;
                    box.innerHTML += html;
                } else {
                    currentSendFunction = sendMessage;
                    box.innerHTML += `<div class="text-gray-200 mb-2 max-h-[38px]">${question.text}</div>`;
                }
                
                setTimeout(() => {
                    createYoutubePlayer(videoId, startTime, endTime, 'youtubePlayerVideo');
                }, 100);
                
                // 타이머 시작
                if (!silent) {
                    if (questionTimer) {
                        clearTimeout(questionTimer);
                        questionTimer = null;
                    }
                    if (countdownInterval) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                    }

                    const timeLimit = (question.timeLimit || 90) * 1000;
                    questionTimer = setTimeout(() => {
                        if (isHost()) {
                            const actualIndex = questionOrder[currentIndex];
                            socket.emit('revealAnswer', {
                                sessionId,
                                questionIndex: actualIndex
                            });
                        }
                    }, timeLimit);

                    startCountdown(question.timeLimit || 90);
                }
                return;
            }
            // 소리 문제 (audio) - 영상 가리기 + YouTube API 사용
            else if (questionType === 'audio') {
                html += `
                    <div class="youtube-player-wrapper max-w-2xl mx-auto my-3 relative">
                        <div class="relative" style="padding-bottom: 56.25%; height: 0;">
                            <!-- YouTube 플레이어 (보이지 않음) -->
                            <div id="youtubePlayerAudio" class="absolute top-0 left-0 w-full h-full rounded-lg" style="pointer-events: none;"></div>
                            
                            <!-- 영상 가리는 검은색 오버레이 -->
                            <div class="absolute inset-0 bg-black rounded-lg flex flex-col items-center justify-center z-10">
                                <div class="text-center mb-4 sm:mb-8">
                                    <svg class="w-16 h-16 sm:w-24 sm:h-24 text-white mx-auto mb-3 sm:mb-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                                    </svg>
                                    <p class="text-lg sm:text-2xl font-bold text-white">소리를 듣고 맞춰보세요!</p>
                                </div>

                                <!-- 볼륨 컨트롤 -->
                                <div class="flex items-center gap-2 sm:gap-3 bg-gray-800/80 px-4 py-2 sm:px-6 sm:py-3 rounded-full border-2 border-gray-600">
                                    <svg class="w-3.5 h-3.5 sm:w-6 sm:h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                                    </svg>
                                    <input
                                        type="range"
                                        id="youtubeVolumeSlider"
                                        class="w-20 sm:w-32 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
                                        min="0"
                                        max="100"
                                        value="${globalYoutubeVolume}"
                                        oninput="setYoutubeVolume(this.value)"
                                        style="pointer-events: auto;"
                                    >
                                    <span id="volumePercent" class="text-white font-bold text-sm sm:text-lg min-w-[35px] sm:min-w-[50px]">${globalYoutubeVolume}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
                // DOM 업데이트 후 플레이어 생성
                box.innerHTML = html;
                
                // 객관식/주관식 문제 UI 추가
                if (question.isChoice && question.choices && question.choices.length > 0) {
                    currentSendFunction = choiceQuestionSendMessage;
                    html = `<div class="text-gray-200 mb-1">${question.text}</div>`;
                    html += `<div class="grid grid-cols-2 md:grid-cols-3 gap-1 justify-items-center w-full max-w-[660px] mx-auto px-4">`;
                    
                    question.choices.forEach((choice, index) => {
                        const keyNumber = index + 1;
                        html += `
                            <button                          
                            onclick="selectChoice('${choice}')"
                            data-choice-index="${index}"
                            class="choice-btn w-full max-w-[200px] min-h-[20px] lg:max-h-[52px] hover:bg-blue-600 border-2 border-gray-600 text-white py-2 px-4 rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg text-[14px] disabled:transform-none break-words leading-tight relative"                     
                            >
                            <span class="absolute top-1 left-2 text-xs text-gray-400 font-bold">${keyNumber}</span>
                            ${choice}
                            </button>
                        `;
                    });
                    html += `</div>`;
                    box.innerHTML += html;
                } else {
                    currentSendFunction = sendMessage;
                    box.innerHTML += `<div class="text-gray-200 mb-2 max-h-[38px]">${question.text}</div>`;
                }
                
                setTimeout(() => {
                    createYoutubePlayer(videoId, startTime, endTime, 'youtubePlayerAudio');
                }, 100);

                // 타이머 시작
                if (!silent) {
                    if (questionTimer) {
                        clearTimeout(questionTimer);
                        questionTimer = null;
                    }
                    if (countdownInterval) {
                        clearInterval(countdownInterval);
                        countdownInterval = null;
                    }

                    const timeLimit = (question.timeLimit || 90) * 1000;
                    questionTimer = setTimeout(() => {
                        if (isHost()) {
                            const actualIndex = questionOrder[currentIndex];
                            socket.emit('revealAnswer', {
                                sessionId,
                                questionIndex: actualIndex
                            });
                        }
                    }, timeLimit);

                    startCountdown(question.timeLimit || 90);
                }
                return;
            }
            // questionType이 없는 기존 유튜브 문제 (기본: video 처리)
            else {
                html += `
                    <div class="youtube-player-wrapper max-w-2xl mx-auto my-3 relative">
                        <div class="relative" style="padding-bottom: 56.25%; height: 0;">
                            <!-- YouTube 플레이어가 여기에 생성됨 -->
                            <div id="youtubePlayerVideo" class="absolute top-0 left-0 w-full h-full rounded-lg" style="pointer-events: none;"></div>
                            
                            <!-- 제목 가리는 검은색 오버레이 + 볼륨 컨트롤 -->
                            <div class="absolute top-0 left-0 w-full h-16 bg-black flex items-center justify-end px-4 rounded-t-lg z-10">
                                <div class="flex items-center gap-3">
                                    <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                                    </svg>
                                    <input 
                                        type="range" 
                                        id="youtubeVolumeSlider"
                                        class="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white" 
                                        min="0" 
                                        max="100" 
                                        value="${globalYoutubeVolume}"
                                        oninput="setYoutubeVolume(this.value)"
                                        style="pointer-events: auto;"
                                    >
                                    <span id="volumePercent" class="text-white font-medium text-sm min-w-[45px]">${globalYoutubeVolume}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
                // DOM 업데이트
                box.innerHTML = html;
                
                // 플레이어 생성
                setTimeout(() => {
                    createYoutubePlayer(videoId, startTime, endTime, 'youtubePlayerVideo');
                }, 100);
            }
        }
    }

    // ========== 객관식 문제 ==========
    if (question.isChoice && question.choices && question.choices.length > 0) {
        currentSendFunction = choiceQuestionSendMessage;
        html += `<div class="text-gray-200 mb-1">${question.text}</div>`;
        html += `<div class="grid grid-cols-2 md:grid-cols-3 gap-1 justify-items-center w-full max-w-[660px] mx-auto px-4">`;
        
        try {
            question.choices.forEach((choice, index) => {
                const keyNumber = index + 1;
                html += `
                    <button                          
                    onclick="selectChoice('${choice}')"
                    data-choice-index="${index}"
                    class="choice-btn w-full max-w-[200px] min-h-[20px] lg:max-h-[52px] hover:bg-blue-600 border-2 border-gray-600 text-white py-2 px-4 rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg text-[14px] disabled:transform-none break-words leading-tight relative"                     
                    >
                    <span class="absolute top-1 left-2 text-xs text-gray-400 font-bold">${keyNumber}</span>
                    ${choice}
                    </button>
                `;
            });
            html += `</div>`;
        } catch (error) {
            console.error('객관식 문제를 불러올수 없습니다:', error);
        }
    } else {
        currentSendFunction = sendMessage;
        html += `<div class="text-gray-200 mb-2 max-h-[38px]">${question.text}</div>`;
    }

    box.innerHTML = html;

    if (silent) return;

    if (questionTimer) {
        clearTimeout(questionTimer);
        questionTimer = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    const timeLimit = (question.timeLimit || 90) * 1000;
    questionTimer = setTimeout(() => {
        if (isHost()) {
            const actualIndex = questionOrder[currentIndex];
            socket.emit('revealAnswer', {
                sessionId,
                questionIndex: actualIndex
            });
        }
    }, timeLimit);

    startCountdown(question.timeLimit || 90);
}

// 객관식 선택 처리
function selectChoice(choice) {
    if (hasAnswered) return;

    hasAnswered = true;

    // 모든 선택지 버튼 가져오기
    const allButtons = document.querySelectorAll('.choice-btn');

    // 클릭한 버튼 찾기 (onclick 속성으로 비교)
    let selectedButton = null;
    allButtons.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(`'${choice}'`)) {
            selectedButton = btn;
        }
    });

    // 선택한 버튼 강조 및 다른 버튼들 비활성화
    if (selectedButton) {
        // 선택한 버튼 스타일
        selectedButton.classList.remove('hover:bg-blue-600', 'border-gray-600');
        selectedButton.classList.add('bg-blue-600', 'border-blue-400', 'ring-2', 'ring-blue-400');
        selectedButton.disabled = true;

        // 다른 버튼들 비활성화 스타일
        allButtons.forEach(btn => {
            if (btn !== selectedButton) {
                btn.classList.add('opacity-40', 'cursor-not-allowed');
                btn.disabled = true;
            }
        });
    }

    const actualIndex = questionOrder[currentIndex];

    // 🛡️ 클라이언트에서 먼저 정답 여부 확인 (해시 비교)
    const isCorrect = (function() {
        const hashedAnswers = questions[actualIndex].answers || []; // 서버에서 해시된 정답
        const userInputHash = hashAnswer(choice); // 사용자 선택을 해시화
        return hashedAnswers.includes(userInputHash);
    })();

    if (!window.__isRevealingAnswer && isCorrect) {
        // ✅ 정답: 서버로 평문 전송하여 재검증
        window.__protectedEmit('choiceQuestionCorrect', {
            sessionId,
            questionIndex: actualIndex,
            answer: choice // 선택한 답 평문 전송 (서버에서 재검증)
        });
    } else if (!window.__isRevealingAnswer) {
        // ❌ 오답: 서버로 오답 전송 (서버에서도 검증)
        window.__protectedEmit('choiceQuestionIncorrect', {
            sessionId,
            questionIndex: actualIndex,
            answer: choice // 오답도 평문 전송 (서버에서 검증)
        });
    }
}

// 게임 채팅 메시지 추가 (프로필 이미지 포함)
function addChatMessage(displayName, profileImage, message, isCorrect = false) {
    try {
        const chatLog = document.getElementById('chatLog');
        
        if (!chatLog) {
            console.error('⌧ chatLog 요소를 찾을 수 없음');
            return;
        }
        
        // 마지막 메시지가 같은 사용자인지 확인
        const lastMessage = chatLog.lastElementChild;
        const isSameUser = lastMessage && 
                          lastMessage.getAttribute('data-user') === displayName &&
                          !isCorrect; // 정답 메시지는 항상 프로필 표시
        
        const messageElement = document.createElement('div');
        messageElement.setAttribute('data-user', displayName);
        
        if (isSameUser) {
            // 연속 메시지: 프로필 없이 텍스트만 표시
            messageElement.className = 'flex items-start text-left translate-y-[-3px] pl-[56px]';
            messageElement.innerHTML = `
                <div class="text-white text-sm break-words max-w-[1000px] text-left">
                    ${message}
                </div>
            `;
        } else {
            // 새로운 메시지: 프로필과 함께 표시
            messageElement.className = 'flex items-start text-left mt-2';

            if (isCorrect) {
                // 정답 메시지 스타일
                if (profileImage && profileImage !== 'https://ssl.pstatic.net/static/pwe/address/img_profile.png') {
                    messageElement.innerHTML = `
                        <div class="flex items-start text-left rounded-lg px-3 max-w-[1000px]">
                            <img src="${profileImage}"
                            class="mt-1 w-8 h-8 mr-3 rounded-full object-cover border-2 border-green-400/50 flex-shrink-0"
                            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                            >
                            <div class="mt-1 w-8 h-8 mr-3 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm border-2 border-green-400/50 flex-shrink-0" style="display: none;">
                                ${displayName.charAt(0).toUpperCase()}
                            </div>
                            <div class="text-left">
                                <div class="font-semibold text-sm text-green-400 mb-1 text-left">${displayName}</div>
                                <div class="text-green-200 text-sm break-words text-left">${message}</div>
                            </div>
                        </div>
                    `;
                } else {
                    messageElement.innerHTML = `
                        <div class="flex items-start text-left rounded-lg px-3 max-w-[1000px]">
                            <div class="mt-1 w-8 h-8 mr-3 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm border-2 border-green-400/50 flex-shrink-0">
                                ${displayName.charAt(0).toUpperCase()}
                            </div>
                            <div class="text-left">
                                <div class="font-semibold text-sm text-green-400 mb-1 text-left">${displayName}</div>
                                <div class="text-green-200 text-sm break-words text-left">${message}</div>
                            </div>
                        </div>
                    `;
                }
            } else {
                // 일반 메시지 스타일
                if (profileImage && profileImage !== 'https://ssl.pstatic.net/static/pwe/address/img_profile.png') {
                    messageElement.innerHTML = `
                        <div class="flex items-start text-left rounded-lg px-3 max-w-[1000px]">
                            <img src="${profileImage}"
                            class="mt-1 w-8 h-8 mr-3 rounded-full object-cover border-2 border-white/20 flex-shrink-0"
                            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                            >
                            <div class="mt-1 w-8 h-8 mr-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border-2 border-white/20 flex-shrink-0" style="display: none;">
                                ${displayName.charAt(0).toUpperCase()}
                            </div>
                            <div class="text-left">
                                <div class="font-semibold text-sm text-white mt-1 text-left">${displayName}</div>
                                <div class="text-white text-sm break-words text-left">${message}</div>
                            </div>
                        </div>
                    `;
                } else {
                    messageElement.innerHTML = `
                        <div class="flex items-start text-left rounded-lg px-3 max-w-[1000px]">
                            <div class="mt-1 w-8 h-8 mr-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border-2 border-white/20 flex-shrink-0">
                                ${displayName.charAt(0).toUpperCase()}
                            </div>
                            <div class="text-left">
                                <div class="font-semibold text-sm text-white mb-1 text-left">${displayName}</div>
                                <div class="text-white text-sm break-words text-left">${message}</div>
                            </div>
                        </div>
                    `;
                }
            }
        }
        
        chatLog.appendChild(messageElement);
        chatLog.scrollTop = chatLog.scrollHeight;
        
    } catch (error) {
        console.error('⌧ addChatMessage 에러:', error);
        console.error('에러 스택:', error.stack);
    }
}

// 정답 표시
function showAnswer({ answers, answerImageBase64, revealedAt }) {
    const box = document.getElementById('questionBox');

    // 기존 내용 완전히 지우기
    box.innerHTML = '';

    // 힌트 숨기기
    const hintDisplay = document.getElementById('hintDisplay');
    if (hintDisplay) {
        hintDisplay.classList.add('hidden');
    }

    let html = '';
    
    // 정답 이미지 (있는 경우)
    if (answerImageBase64) {
        html += `
                <img src="${answerImageBase64}" 
                     alt="정답 이미지" 
                     class="w-auto h-auto max-h-[300px] mx-auto rounded-lg shadow-lg my-4">
        `;
    }

    // 정답 텍스트 섹션
    if (answers) {
        html += `
            <div class="flex answer-reveal justify-center text-center mb-1">
                <h3 class="text-green-400 font-bold">정답 :&nbsp</h3>
                <div class="text-green-200 font-semibold">
                    ${displayAnswer}
                </div>
            </div>
        `;
    }

    box.innerHTML = html;

    // ✅ 정답 공개 상태 설정
    window.__isRevealingAnswer = true;

    // ✅ 5초 후 다음 문제로 넘어가기 (서버 시간 차이를 고려하지 않고 정확히 5초)
    setTimeout(() => {
        window.__isRevealingAnswer = false;
        if (isHost()) {
            socket.emit('nextQuestion', { sessionId, userId });
        }
    }, 5000);
}

// 퀴즈 추천 토글
async function toggleRecommendation() {
    if (!sessionData || !sessionData.quiz || !sessionData.quiz._id) {
        return;
    }

    const quizId = sessionData.quiz._id;

    // 양쪽 버튼 모두 가져오기
    const recommendBtn = document.getElementById('recommendBtn');
    const endRecommendBtn = document.getElementById('endRecommendBtn');

    const recommendIcon = document.getElementById('recommendIcon');
    const recommendCount = document.getElementById('recommendCount');

    const endRecommendIcon = document.getElementById('endRecommendIcon');
    const endRecommendCount = document.getElementById('endRecommendCount');

    // 버튼 비활성화 (중복 클릭 방지)
    if (recommendBtn) recommendBtn.disabled = true;
    if (endRecommendBtn) endRecommendBtn.disabled = true;

    try {
        const response = await fetchWithAuth(`/quiz/${quizId}/recommend`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '추천 처리에 실패했습니다.');
        }

        const data = await response.json();

        if (data.success) {
            // 아이콘 및 추천 수 업데이트 (양쪽 모두)
            const newIconSrc = data.recommended ? '/images/Thumbsup2.png' : '/images/Thumbsup1.png';

            if (recommendIcon) recommendIcon.src = newIconSrc;
            if (endRecommendIcon) endRecommendIcon.src = newIconSrc;

            if (recommendCount) recommendCount.textContent = data.recommendationCount;
            if (endRecommendCount) endRecommendCount.textContent = data.recommendationCount;

            // sessionData 업데이트
            sessionData.quiz.hasRecommended = data.recommended;
            sessionData.quiz.recommendationCount = data.recommendationCount;

            // quizData도 업데이트 (종료 화면에서 사용)
            if (quizData) {
                quizData.hasRecommended = data.recommended;
                quizData.recommendationCount = data.recommendationCount;
            }
        }
    } catch (error) {
        console.error('추천 처리 오류:', error);
        alert(error.message);
    } finally {
        // 버튼 재활성화
        if (recommendBtn) recommendBtn.disabled = false;
        if (endRecommendBtn) endRecommendBtn.disabled = false;
    }
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 추천 버튼 (대기 화면)
    const recommendBtn = document.getElementById('recommendBtn');
    if (recommendBtn) {
        recommendBtn.addEventListener('click', toggleRecommendation);
    }

    // 추천 버튼 (종료 화면)
    const endRecommendBtn = document.getElementById('endRecommendBtn');
    if (endRecommendBtn) {
        endRecommendBtn.addEventListener('click', toggleRecommendation);
    }

    // 스킵 투표 버튼
    document.getElementById('voteSkipBtn').addEventListener('click', () => {
        socket.emit('voteSkip', { sessionId });
    });

    // 강제 스킵 버튼 (클릭 후 포커스 제거하여 엔터 키 실수 방지)
    document.getElementById('forceSkipBtn').addEventListener('click', (e) => {
        socket.emit('forceSkip', { sessionId });
        e.target.blur(); // 클릭 후 포커스 제거
    });

    // 모바일 스킵 투표 버튼
    document.getElementById('voteSkipBtnMobile').addEventListener('click', () => {
        socket.emit('voteSkip', { sessionId });
    });

    // 모바일 강제 스킵 버튼
    document.getElementById('forceSkipBtnMobile').addEventListener('click', (e) => {
        socket.emit('forceSkip', { sessionId });
        e.target.blur(); // 클릭 후 포커스 제거
    });

    // ❌ 제거: HTML form onsubmit과 중복되어 두 번 호출되는 문제 발생
    // 채팅 입력은 form submit으로 처리됨 (quiz-session.html 373번 줄)

    // ESC 키: 포커스 해제 핸들러
    function handleEscapeKey(e) {
        if (e.key === 'Escape') {
            if (document.activeElement.tagName === 'INPUT' ||
                document.activeElement.tagName === 'TEXTAREA') {
                document.activeElement.blur();
            }
        }
    }

    // Enter 키: 채팅창 포커스 핸들러
    function handleEnterKey(e) {
        if (e.key === 'Enter') {
            if (document.activeElement.tagName !== 'INPUT' &&
                document.activeElement.tagName !== 'TEXTAREA' &&
                document.activeElement.tagName !== 'BUTTON') {

                const gameSection = document.getElementById('gameSection');
                const quizInfoSection = document.getElementById('quizInfoSection');

                if (!gameSection.classList.contains('hidden')) {
                    document.getElementById('chatInput').focus();
                } else if (!quizInfoSection.classList.contains('hidden')) {
                    document.getElementById('waitingChatInput').focus();
                }
            }
        }
    }

    // K 키: 스킵 투표, P 키: 강제 스킵 핸들러
    function handleSkipVoteKey(e) {
        // 입력 필드에서는 단축키 비활성화
        if (document.activeElement.tagName === 'INPUT' ||
            document.activeElement.tagName === 'TEXTAREA') {
            return;
        }

        const gameSection = document.getElementById('gameSection');
        if (gameSection.classList.contains('hidden')) {
            return;
        }

        // K 키: 스킵 투표
        if (e.key === 'k' || e.key === 'K') {
            const voteSkipBtn = document.getElementById('voteSkipBtn');
            const voteSkipBtnMobile = document.getElementById('voteSkipBtnMobile');

            if (!voteSkipBtn.classList.contains('hidden') ||
                !voteSkipBtnMobile.classList.contains('hidden')) {
                socket.emit('voteSkip', { sessionId });

                // 시각적 피드백
                [voteSkipBtn, voteSkipBtnMobile].forEach(btn => {
                    if (!btn.classList.contains('hidden')) {
                        btn.classList.add('scale-95', 'opacity-70');
                        setTimeout(() => {
                            btn.classList.remove('scale-95', 'opacity-70');
                        }, 150);
                    }
                });
            }
        }

        // P 키: 강제 스킵 (호스트만)
        if (e.key === 'p' || e.key === 'P') {
            const forceSkipBtn = document.getElementById('forceSkipBtn');
            const forceSkipBtnMobile = document.getElementById('forceSkipBtnMobile');

            if (!forceSkipBtn.classList.contains('hidden') ||
                !forceSkipBtnMobile.classList.contains('hidden')) {
                socket.emit('forceSkip', { sessionId });

                // 시각적 피드백
                [forceSkipBtn, forceSkipBtnMobile].forEach(btn => {
                    if (!btn.classList.contains('hidden')) {
                        btn.classList.add('scale-95', 'opacity-70');
                        setTimeout(() => {
                            btn.classList.remove('scale-95', 'opacity-70');
                        }, 150);
                    }
                });
            }
        }
    }

    // 이벤트 리스너 등록
    document.addEventListener('keydown', handleChoiceKeyPress);
    document.addEventListener('keydown', handleEscapeKey);
    document.addEventListener('keydown', handleEnterKey);
    document.addEventListener('keydown', handleSkipVoteKey);

    const toggleCodeBtn = document.getElementById('toggleCodeBtn');
    if (toggleCodeBtn) {
        toggleCodeBtn.addEventListener('click', toggleCodeVisibility);
    }

    const copyInviteBtn = document.getElementById('copyInviteBtn');
    if (copyInviteBtn) {
        copyInviteBtn.addEventListener('click', copyInviteCode);
    }

    const waitingChatInput = document.getElementById('waitingChatInput');
    if (waitingChatInput) {
        waitingChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                currentWaitingSendFunction();
            }
        });
    }
}

// Socket 이벤트 리스너들
function setupSocketListeners() {
    // Socket 연결 상태 모니터링
    socket.on('connect', () => {
        // userId가 설정되어 있으면 joinSession 실행
        if (userId) {
            socket.emit('joinSession', { sessionId });
        }
    });

    // ⚡ joinSession 성공 시 한 번에 모든 데이터 수신 (HTTP 요청 불필요!)
    socket.on('join-success', (response) => {
        if (!response.success) return;

        const data = response.data;

        // 세션 데이터 저장
        sessionData = data;
        host = data.host;

        // ⚡ 문제 수 표시 (questions 배열 없이)
        document.getElementById('totalQuestions').textContent = data.questionCount || 0;

        // 퀴즈 정보 표시 (questions는 제외)
        document.getElementById('quizTitle').textContent = data.quiz.title;
        document.getElementById('quizDescription').textContent = data.quiz.description || '이 퀴즈에 도전해보세요!';

        // 썸네일 이미지 표시
        const thumbnailContainer = document.getElementById('quizThumbnail');
        const defaultThumbnail = document.getElementById('defaultThumbnail');

        if (data.quiz.titleImageBase64) {
            if (defaultThumbnail) {
                defaultThumbnail.style.display = 'none';
            }

            let imgElement = thumbnailContainer.querySelector('img:not(#recommendIcon)');
            if (!imgElement) {
                imgElement = document.createElement('img');
                imgElement.className = 'absolute inset-0 w-full h-full object-cover';
                imgElement.alt = data.quiz.title;
                thumbnailContainer.insertBefore(imgElement, thumbnailContainer.firstChild);
            }
            imgElement.src = data.quiz.titleImageBase64;
        }

        // ⚡ 플레이어 목록 표시 (waiting-room 이벤트 기다릴 필요 없음)
        if (data.players && data.players.length > 0) {
            renderPlayerList(data.players);
        }

        // 초대 코드 표시
        if (data.inviteCode) {
            setInviteCode(data.inviteCode);
        } else {
            document.getElementById('inviteCodeDisplay').textContent = '없음';
        }

        // 추천 버튼 표시 및 상태 설정
        const recommendSection = document.getElementById('recommendSection');
        const recommendIcon = document.getElementById('recommendIcon');
        const recommendCount = document.getElementById('recommendCount');

        if (recommendSection) {
            // 추천 버튼 표시
            recommendSection.classList.remove('hidden');

            // 추천 수 표시
            if (recommendCount) {
                recommendCount.textContent = data.quiz.recommendationCount || 0;
            }

            // 추천 상태에 따라 아이콘 변경
            if (recommendIcon) {
                if (data.quiz.hasRecommended) {
                    recommendIcon.src = '/images/Thumbsup2.png';
                } else {
                    recommendIcon.src = '/images/Thumbsup1.png';
                }
            }
        }

        // 제작자 정보 표시
        const creatorSection = document.getElementById('creatorSection');
        const creatorNickname = document.getElementById('creatorNickname');

        if (creatorSection && creatorNickname && data.quiz.creatorNickname) {
            creatorNickname.textContent = data.quiz.creatorNickname;
            creatorSection.classList.remove('hidden');
        }

        // 댓글 모듈 초기화 (퀴즈 ID와 사용자 정보 전달)
        // 로그인 없이도 댓글을 볼 수 있도록 user는 null일 수 있음
        // 캐시된 사용자 정보 사용 (중복 API 호출 방지)
        if (data.quiz && data.quiz._id) {
            getCachedUserData()
                .then(user => {
                    initializeComments(data.quiz._id, user);
                })
                .catch(() => {
                    // 로그인하지 않은 경우에도 댓글 목록은 볼 수 있도록
                    initializeComments(data.quiz._id, null);
                });
        }

        // 로딩 완료 플래그
        isDataLoaded = true;
    });

    socket.on('join-error', ({ success, message }) => {
        alert(message || '게임 세션 참가에 실패했습니다.');
        window.location.href = '/';
    });

    socket.on('waiting-room', ({ success, data, message }) => {

        if (!success) {
            console.error('대기실 로딩 실패:', message || '알 수 없는 오류');
            return;
        }

        const { host: newHost, players, isStarted } = data;
        host = newHost;
        
        // 참가자 목록 업데이트
        renderPlayerList(players);

        // 호스트만 시작 버튼 표시
        const startBtn = document.getElementById('startBtn');
        if (userId === host && !isStarted) {
            startBtn.classList.remove('hidden');
            startBtn.onclick = () => {
                socket.emit('startGame', { sessionId, userId });
                startBtn.disabled = true;
                startBtn.textContent = '게임 시작 중...';
            };
        } else {
            startBtn.classList.add('hidden');
        }
    });

    socket.on('game-started', ({ success, data, message }) => {
        try {
            if (!success) {
                console.error('게임 시작 실패:', message);
                alert(message || '게임을 시작할 수 없습니다.');
                return;
            }

            const { quiz, host: newHost, questionOrder: order, isReconnect, currentIndex: serverCurrentIndex, playerAnswered, revealedAt, players } = data;

            if (!quiz || !Array.isArray(quiz.questions)) {
                console.error('잘못된 퀴즈 구조:', quiz);
                alert('퀴즈 데이터가 손상되었습니다.');
                return;
            }

        host = newHost;

        // quizData 저장
        quizData = quiz;

        // 문제 순서 배열 저장 (서버에서 전송받은 순서 또는 기본 순서)
        questionOrder = order || Array.from({ length: quiz.questions.length }, (_, i) => i);

        // ✅ 실제 플레이 중인 문제의 정답 정보 확인 (questionOrder 적용)
        const actualCurrentIndex = questionOrder[serverCurrentIndex || 0];


        // 🛡️ 서버에서 이미 choices를 만들어서 보낸 경우 그대로 사용
        questions = quiz.questions.map(question => {
            // 이미 choices가 있으면 (서버에서 만든 경우) 그대로 사용
            if (question.choices && question.choices.length > 0) {
                return {
                    ...question,
                    isChoice: true
                };
            }

            // 하위 호환성: 기존 방식 (incorrectAnswers로 choices 생성)
            if (question.incorrectAnswers && question.incorrectAnswers.length > 0) {
                // 정답 + 오답 섞기
                const allChoices = [...question.answers, ...question.incorrectAnswers];

                // Fisher-Yates 셔플
                for (let i = allChoices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]];
                }

                return {
                    ...question,
                    isChoice: true,
                    choices: allChoices
                };
            }

            return {
                ...question,
                isChoice: false
            };
        });


        // 🔄 재접속인 경우 서버에서 받은 currentIndex 사용, 아니면 0
        currentIndex = isReconnect ? (serverCurrentIndex || 0) : 0;

        showGameSection();

        if (Array.isArray(players) && players.length > 0) {
            renderScoreboard(players);
        }

        // 문제 표시 (silent 모드: 타이머 시작하지 않음)
        showQuestion({ silent: true });
        updateQuestionNumber();

        // 🔄 재접속 시 hasAnswered 상태 복원
        if (isReconnect && playerAnswered) {
            const actualQuestionIndex = questionOrder[currentIndex];
            hasAnswered = playerAnswered[actualQuestionIndex] === true;
        }

        // ✅ 재접속 시 정답 공개 상태인 경우 처리
        if (isReconnect && revealedAt) {
            // 힌트 숨기기
            const hintDisplay = document.getElementById('hintDisplay');
            if (hintDisplay) {
                hintDisplay.classList.add('hidden');
            }

            window.__isRevealingAnswer = true;
            currentRevealedAt = new Date(revealedAt);

            // ✅ 타이머가 이미 실행 중이면 새로 만들지 않음 (중복 방지)
            if (!nextQuestionTimer) {
                // 남은 시간 계산
                const elapsed = (Date.now() - currentRevealedAt.getTime()) / 1000;
                const remainingTime = Math.max(0, Math.min(5, 5 - elapsed)) * 1000;
                // ✅ currentIndex 클로저 캡처
                const questionIndexAtReveal = currentIndex;

                // 남은 시간 후 다음 문제로 넘어가기
                nextQuestionTimer = setTimeout(() => {
                    window.__isRevealingAnswer = false;
                    currentRevealedAt = null;
                    nextQuestionTimer = null;
                    if (isHost()) {
                        socket.emit('nextQuestion', {
                            sessionId,
                            userId,
                            questionIndex: questionIndexAtReveal
                        });
                    }
                }, remainingTime);
            }
        }
        // ✅ 정답 공개 전이면 무조건 client-ready 전송 (재접속 시에도!)
        // 이렇게 해야 재접속 시에도 타이머가 정상적으로 시작됩니다
        else {
            socket.emit('client-ready', { sessionId });
        }
        } catch (error) {
            console.error('❌ game-started 처리 중 에러:', error);
            alert('게임 데이터 처리 중 오류가 발생했습니다. 페이지를 새로고침 해주세요.');
        }
    });

    socket.on('host-updated', ({ success, data, message }) => {
        if (!success) {
            console.error('호스트 갱신 실패:', message);
            return;
        }

        const previousHost = host;
        host = data.host;

        const isGameStarted = !document.getElementById('gameSection').classList.contains('hidden');
        const startBtn = document.getElementById('startBtn');

        // 데스크톱 버튼
        const forceSkipBtn = document.getElementById('forceSkipBtn');
        // 모바일 버튼
        const forceSkipBtnMobile = document.getElementById('forceSkipBtnMobile');

        if (host === '__NONE__') {
            forceSkipBtn.classList.add('hidden');
            forceSkipBtnMobile.classList.add('hidden');
            startBtn?.classList.add('hidden');
        } else if (userId === host) {
            if (isGameStarted) {
                forceSkipBtn.classList.remove('hidden');
                forceSkipBtnMobile.classList.remove('hidden');
            }
            if (!isGameStarted) {
                startBtn?.classList.remove('hidden');
            }

            // ✅ 정답 공개 상태에서 새로운 호스트가 된 경우, 남은 시간 후 자동으로 nextQuestion 전송
            if (window.__isRevealingAnswer && currentRevealedAt && previousHost !== host) {
                // ✅ 타이머가 이미 실행 중이면 새로 만들지 않음 (중복 방지)
                if (!nextQuestionTimer) {
                    // 남은 시간 계산 (최대 5초)
                    const elapsed = (Date.now() - currentRevealedAt.getTime()) / 1000;
                    const remainingTime = Math.max(0, Math.min(5, 5 - elapsed)) * 1000;
                    // ✅ currentIndex 클로저 캡처
                    const questionIndexAtReveal = currentIndex;

                    // 남은 시간 후 nextQuestion 전송
                    nextQuestionTimer = setTimeout(() => {
                        window.__isRevealingAnswer = false;
                        currentRevealedAt = null;
                        nextQuestionTimer = null;
                        if (isHost()) {
                            socket.emit('nextQuestion', {
                                sessionId,
                                userId,
                                questionIndex: questionIndexAtReveal
                            });
                        }
                    }, remainingTime);
                }
            }
        } else {
            forceSkipBtn.classList.add('hidden');
            forceSkipBtnMobile.classList.add('hidden');
            startBtn?.classList.add('hidden');
        }
    });

    socket.on('voteSkipUpdate', ({ success, data, votes, total }) => {
        if (success === false && data === undefined) {
            renderSkipStatus(votes, total);
        } else {
            if (data) {
                renderSkipStatus(data.votes, data.total);
            }
        }
    });

    socket.on('next', ({ success, data, message }) => {
        if (!success) {
            console.error('다음 문제 전송 실패:', message);
            return;
        }

        // ✅ 이전 문제의 타이머 정리 (지연된 이벤트 방지)
        if (questionTimer) {
            clearTimeout(questionTimer);
            questionTimer = null;
        }
        if (nextQuestionTimer) {
            clearTimeout(nextQuestionTimer);
            nextQuestionTimer = null;
        }
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }

        // ✅ 이전 문제의 유튜브 플레이어 즉시 정리 (백그라운드 재생 방지)
        if (youtubePlayer) {
            try {
                youtubePlayer.stopVideo();
                youtubePlayer.destroy();
            } catch (error) {
                console.error('유튜브 플레이어 정지 실패:', error);
            }
            youtubePlayer = null;
        }

        const { currentIndex: newIndex, totalPlayers } = data;
        currentIndex = newIndex;
        renderSkipStatus(0, totalPlayers);

        // 문제 표시 (silent 모드: 타이머 시작하지 않음)
        showQuestion({ silent: true });
        updateQuestionNumber();

        // 로딩 완료 알림
        socket.emit('client-ready', { sessionId });
    });

    // 모든 플레이어 준비 완료 후 문제 시작
    socket.on('question-start', ({ success, data }) => {
        if (!success) {
            return;
        }

        const { questionStartAt: startAt, timeLimit, isReconnect } = data;
        questionStartAt = new Date(startAt);

        // 타이머 시작
        const actualIndex = questionOrder[currentIndex];
        const question = questions[actualIndex];

        if (questionTimer) {
            clearTimeout(questionTimer);
            questionTimer = null;
        }
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }

        let remainingTime;
        let remainingSeconds;

        if (isReconnect) {
            // ✅ 재접속 시: questionStartAt 기반으로 경과시간 계산
            const totalTimeLimit = (timeLimit || question.timeLimit || 90) * 1000;
            const elapsed = Math.max(0, Date.now() - questionStartAt.getTime());
            remainingTime = Math.max(0, totalTimeLimit - elapsed);
            remainingSeconds = Math.max(0, Math.ceil(remainingTime / 1000));
        } else {
            // ✅ 정상 진행 시: 서버에서 받은 timeLimit을 그대로 사용 (사용자 시간에 의존하지 않음)
            const timeLimitValue = timeLimit || question.timeLimit || 90;
            remainingTime = timeLimitValue * 1000;
            remainingSeconds = timeLimitValue;
        }

        // ✅ 남은 시간으로 타이머 시작
        questionTimer = setTimeout(() => {
            if (isHost()) {
                const actualIndex = questionOrder[currentIndex];
                socket.emit('revealAnswer', {
                    sessionId,
                    questionIndex: actualIndex
                });
            }
        }, remainingTime);

        // ✅ 남은 시간으로 카운트다운 시작
        startCountdown(remainingSeconds);
    });

    socket.on('chat', ({ user, nickname, profileImage, message }) => {
        const displayName = nickname || user;
        const isMyMessage = user === socket.userId;;

        const gameSection = document.getElementById('gameSection');
        if (gameSection.classList.contains('hidden')) {
            displayWaitingChat(displayName, profileImage, message, isMyMessage);
        } else {
            addChatMessage(displayName, profileImage, message, false);
        }
    });

    socket.on('correct', ({ success, data, message }) => {
        if (!success) {
            console.error('⌧ 정답 수신 실패:', message);
            return;
        }

        const { nickname, profileImage } = data;

        addChatMessage(nickname, profileImage, `${nickname}님이 정답을 맞혔습니다!`, true);

        // 주관식 정답 - 즉시 초록색 테두리 추가
        correctUsersThisQuestion.add(nickname);
        const scoreboardItem = document.querySelector(`#scoreboard li[data-nickname="${nickname}"]`);
        if (scoreboardItem) {
            scoreboardItem.classList.remove('border-blue-400');
            scoreboardItem.classList.add('border-green-500');
        }
    });
    
    socket.on('scoreboard', ({ success, message, data }) => {

        if (!success) {
            console.error('점수판 로딩 실패:', message);
            return;
        }
        renderScoreboard(data.players);
    });

    socket.on('choiceQuestionScoreboard', ({ success, message, data }) => {
        if (!success) {
            console.error('점수판 로딩 실패:', message);
            return;
        }

        renderScoreboard(data.players);

        if (isHost()) {
            socket.emit('revealAnswer', { sessionId });
        }
    });

    socket.on('revealAnswer_Emit', ({ success, data, message }) => {
        if (!success) {
            console.error('정답 공개 실패:', message);
            return;
        }

        const { answers, answerImage, revealedAt, correctUsers } = data;

        // ✅ 2. 채팅창에 정답자 표시
        displayCorrectUsersInChat(correctUsers);

        // ✅ 3. 정답 공개 화면 표시 (유튜브 포함)
        showAnswerWithYoutube({
            answers,
            answerImageBase64: answerImage,
            revealedAt,
            index: data.index
        });
    });

    socket.on('end', ({ success, message, data }) => {
        if (!success) {
            console.error('퀴즈 종료 오류:', message);
            return;
        }

        // 퀴즈 종료 화면 표시 (제작자 정보 + 퍼센타일 포함)
        showGameEndScreen(data.players, data.creatorNickname, data.percentileThresholds);
    });

    socket.on('forceRedirect', (data) => {
        alert('세션이 종료되어 메인 페이지로 이동합니다.');
        window.location.href = data.url || '/';
    });
}

// 퀴즈 종료 화면 표시
function showGameEndScreen(players, creatorNickname, percentileThresholds) {
    // 유튜브 플레이어 정지 및 제거
    if (youtubePlayer) {
        try {
            youtubePlayer.stopVideo();
            youtubePlayer.destroy();
        } catch (error) {
            console.error('유튜브 플레이어 정지 실패:', error);
        }
        youtubePlayer = null;
    }

    // 모든 섹션 숨기기
    document.getElementById('quizInfoSection').classList.add('hidden');
    document.getElementById('gameSection').classList.add('hidden');

    // 종료 화면 표시
    const gameEndSection = document.getElementById('gameEndSection');
    gameEndSection.classList.remove('hidden');

    // 종료 화면에 퀴즈 정보 표시
    if (quizData) {
        document.getElementById('endQuizTitle').textContent = quizData.title;
        document.getElementById('endRecommendCount').textContent = quizData.recommendationCount || 0;

        // 제작자 정보 표시 (서버에서 받은 값 우선 사용)
        const endCreatorNickname = document.getElementById('endCreatorNickname');
        if (endCreatorNickname) {
            endCreatorNickname.textContent = creatorNickname || quizData.creatorNickname || '알 수 없음';
        }

        // 추천 상태에 따라 아이콘 변경
        const endRecommendIcon = document.getElementById('endRecommendIcon');
        if (quizData.hasRecommended) {
            endRecommendIcon.src = '/images/Thumbsup2.png';
        } else {
            endRecommendIcon.src = '/images/Thumbsup1.png';
        }
    }

    // 최종 순위 렌더링
    renderFinalRanking(players, percentileThresholds);
}

// 최종 순위 렌더링
function renderFinalRanking(players, percentileThresholds) {
    const rankingList = document.getElementById('finalRankingList');
    rankingList.innerHTML = '';

    // 점수순으로 정렬 (내림차순)
    const sortedPlayers = players
        .filter(p => p.connected)
        .slice()
        .sort((a, b) => b.score - a.score);

    sortedPlayers.forEach((player, index) => {
        const rank = index + 1;
        const displayName = player.nickname || 'Unknown';

        // 퍼센타일 계산 (임계값이 있을 때만)
        if (percentileThresholds) {
            const correctCount = player.correctAnswersCount || 0;
            if (correctCount >= percentileThresholds.top1) {
                player.percentile = '상위 1%';
            } else if (correctCount >= percentileThresholds.top3) {
                player.percentile = '상위 3%';
            } else if (correctCount >= percentileThresholds.top5) {
                player.percentile = '상위 5%';
            } else if (correctCount >= percentileThresholds.top10) {
                player.percentile = '상위 10%';
            } else if (correctCount >= percentileThresholds.top30) {
                player.percentile = '상위 30%';
            } else if (correctCount >= percentileThresholds.top50) {
                player.percentile = '상위 50%';
            }
        }

        // 1등, 2등, 3등에 특별한 스타일 적용
        let rankBadgeClass = '';
        let cardBorderClass = '';

        if (rank === 1) {
            rankBadgeClass = 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-yellow-900';
            cardBorderClass = 'border-yellow-400';
        } else if (rank === 2) {
            rankBadgeClass = 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-800';
            cardBorderClass = 'border-gray-400';
        } else if (rank === 3) {
            rankBadgeClass = 'bg-gradient-to-r from-orange-400 to-orange-600 text-orange-900';
            cardBorderClass = 'border-orange-400';
        } else {
            rankBadgeClass = 'bg-gray-600 text-gray-300';
            cardBorderClass = 'border-gray-600';
        }

        // 프로필 이미지 또는 이니셜 아바타
        const avatarHTML = createPlayerAvatar(player);

        const li = document.createElement('li');
        li.className = `bg-gray-700/50 rounded-xl p-4 border-2 ${cardBorderClass} transition-all duration-200 hover:scale-105 hover:shadow-lg`;

        li.innerHTML = `
            <div class="flex items-center gap-2">
                <!-- 순위 배지 -->
                <div class="${rankBadgeClass} w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 font-bold shadow-lg">
                    ${rank}
                </div>

                <!-- 프로필 이미지 -->
                <div class="flex-shrink-0">
                    ${avatarHTML.replace('w-10 h-10', 'w-12 h-12').replace('text-sm', 'text')}
                </div>

                <!-- 사용자 정보 -->
                <div class="flex-1">
                    <div class="text-white font-bold mb-1">${displayName}</div>
                    <div class="flex items-center gap-4 text-sm">
                        <span class="text-green-400 font-semibold">
                            <span class="text-gray-400">점수:</span> ${player.score}점
                        </span>
                        <span class="text-blue-400 font-semibold">
                            <span class="text-gray-400">맞춘 문제:</span> ${player.correctAnswersCount || 0}개
                        </span>
                        ${player.percentile ? `
                        <span class="text-yellow-400 font-bold text-sm px-2 py-1 bg-yellow-400/20 rounded-full border border-yellow-400/40 animate-pulse">
                            ${player.percentile}
                        </span>
                        ` : ''}
                    </div>
                </div>

                <!-- 순위 번호 (오른쪽) -->
                <div class="text-gray-400 font-bold text-xl flex-shrink-0">
                    #${rank}
                </div>
            </div>
        `;

        rankingList.appendChild(li);
    });
}

// 페이지 초기화
async function initializePage() {
    try {
        setupEventListeners();

        window.addEventListener('beforeunload', () => {
            // 모든 keydown 이벤트 리스너 정리 (메모리 누수 방지)
            document.removeEventListener('keydown', handleChoiceKeyPress);
            document.removeEventListener('keydown', handleEscapeKey);
            document.removeEventListener('keydown', handleEnterKey);
            document.removeEventListener('keydown', handleSkipVoteKey);

            // Socket.IO 리스너도 정리
            if (socket) {
                socket.removeAllListeners();
                socket.disconnect();
            }
        });

        // 병렬로 실행하여 로딩 시간 단축
        await renderNavbar();
        highlightCurrentPage();

        // 사용자 정보 초기화 (로그인 또는 게스트)
        await initializeUser();

        // 채팅 기록 로딩 기능 제거됨 - 새로고침 시 채팅 초기화


    } catch (error) {
        console.error('페이지 초기화 실패:', error);
        alert('페이지 초기화 중 오류가 발생했습니다.');
        window.location.href = '/';
    }
}

// 초대코드 복사 함수
async function copyInviteCode() {
  if (!actualInviteCode) {
    return;
  }
  
  const copyBtn = document.getElementById('copyInviteBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const copyIcon = document.getElementById('copyIcon');
  
  try {
    // 클립보드에 복사
    await navigator.clipboard.writeText(actualInviteCode);
    
    // 버튼 상태 변경 (성공)
    copyBtnText.textContent = '복사완료!';
    copyIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
    `;
    copyBtn.classList.remove('bg-[#8BA2FA]', 'hover:bg-[#617DE9]', 'hover:to-blue-600');
    copyBtn.classList.add('bg-green-500', 'hover:bg-green-600');
    
    // 2초 후 원래 상태로 복구
    setTimeout(() => {
      copyBtnText.textContent = '복사';
      copyIcon.innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
      `;
      copyBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
      copyBtn.classList.add('bg-[#8BA2FA]', 'hover:bg-[#617DE9]');
    }, 2000);
    
  } catch (err) {
    console.error('클립보드 복사 실패:', err);
    // 폴백: 텍스트 선택 방식
    fallbackCopyToClipboard(actualInviteCode);
  }
}

// 폴백 복사 함수
function fallbackCopyToClipboard(text) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    if (successful) {
      setTimeout(() => {
      }, 2000);
    }
  } catch (err) {
    console.error('폴백 복사도 실패:', err);
    alert('복사에 실패했습니다. 수동으로 복사해주세요: ' + text);
  }
}

// 코드 가시성 토글 함수
function toggleCodeVisibility() {
  const codeDisplay = document.getElementById('inviteCodeDisplay');
  const eyeIcon = document.getElementById('eyeIcon');
  
  if (!actualInviteCode) return; // 코드가 없으면 토글 안함
  
  if (isCodeVisible) {
    // 숨기기
    codeDisplay.textContent = '••••••';
    eyeIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
    `;
    document.getElementById('toggleCodeBtn').title = '코드 보기';
  } else {
    // 보이기
    codeDisplay.textContent = actualInviteCode;
    eyeIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L18 18"></path>
    `;
    document.getElementById('toggleCodeBtn').title = '코드 숨기기';
  }
  
  isCodeVisible = !isCodeVisible;
}

// 초대코드 설정 함수
function setInviteCode(code) {
  actualInviteCode = code;
  isCodeVisible = false; // 기본적으로 숨겨진 상태
  
  const codeDisplay = document.getElementById('inviteCodeDisplay');
  const toggleBtn = document.getElementById('toggleCodeBtn');
  const copyBtn = document.getElementById('copyInviteBtn');
  
  // 마스킹 표시
  codeDisplay.textContent = '••••••';
  
  // 버튼들 활성화
  toggleBtn.disabled = false;
  toggleBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  
  copyBtn.disabled = false;
  copyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  
}

// 대기실 채팅 전송
function sendWaitingMessage() {
    const input = document.getElementById('waitingChatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // 서버에 전송 (사용자 정보 및 타임스탬프 포함)
    socket.emit('chatMessage', { 
        sessionId, 
        message,
    });
    
    input.value = '';
}

function displayWaitingChat(user, profileImage, message, isMyMessage) {
    try {
        const chatLog = document.getElementById('waitingChatLog');
        const profileImageUrl = profileImage;
        
        if (!chatLog) {
            console.error('⌧ waitingChatLog 요소를 찾을 수 없음');
            return;
        }
        
        // 마지막 메시지가 같은 사용자인지 확인
        const lastMessage = chatLog.lastElementChild;
        const isSameUser = lastMessage && 
                          lastMessage.getAttribute('data-user') === user;
        
        const messageElement = document.createElement('div');
        messageElement.setAttribute('data-user', user); // 사용자 정보 저장
        
        if (isSameUser) {
            // 연속 메시지: 프로필 없이 텍스트만 표시
            messageElement.className = 'flex items-start translate-y-[-3px] pl-[56px]'; // 프로필 이미지 크기만큼 왼쪽 패딩
            messageElement.innerHTML = `
                <div class="text-white text-sm break-words">
                    ${message}
                </div>
            `;
        } else {
            // 새로운 사용자 메시지: 프로필과 함께 표시
            messageElement.className = 'flex items-start mt-2';
            
            if (profileImageUrl && profileImageUrl !== 'https://ssl.pstatic.net/static/pwe/address/img_profile.png') {
                messageElement.innerHTML = `
                    <div class="flex items-start rounded-lg px-3 max-w-[1000px]">
                        <img src="${profileImageUrl}"
                        class="mt-1 w-8 h-8 mr-3 rounded-full object-cover border-2 border-white/20 flex-shrink-0"
                        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                        >
                        <div class="mt-1 w-8 h-8 mr-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border-2 border-white/20 flex-shrink-0" style="display: none;">
                            ${user.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div class="font-semibold text-sm text-white">${user}</div>
                            <div class="text-white text-sm break-words items-start">${message}</div>
                        </div>
                    </div>
                `;
            } else {
                messageElement.innerHTML = `
                    <div class="flex items-start rounded-lg px-3 max-w-[1000px]">
                        <div class="mt-1 w-8 h-8 mr-3 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border-2 border-white/20 flex-shrink-0">
                            ${user.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div class="font-semibold text-sm text-white mb-1">${user}</div>
                            <div class="text-white text-sm break-words">${message}</div>
                        </div>
                    </div>
                `;
            }
        }
        
        chatLog.appendChild(messageElement);
        chatLog.scrollTop = chatLog.scrollHeight;
        
    } catch (error) {
        console.error('displayWaitingChat 에러:', error);
        console.error('에러 스택:', error.stack);
    }
}

function getUserProfileFromDOM() {
    // 참가자 목록에서 현재 사용자 찾기
    const playerItems = document.querySelectorAll('#playerList li');
    
    for (let item of playerItems) {
        const myIndicator = item.querySelector('.text-blue-400'); // "나" 표시
        if (myIndicator && myIndicator.textContent.includes('나')) {
            // 프로필 이미지 추출
            const profileImg = item.querySelector('img');
            
            let profileImage = null;
            if (profileImg && profileImg.style.display !== 'none') {
                profileImage = profileImg.src;
            }

            const nameElement = item.querySelector('.font-medium');
            const displayName = nameElement ? nameElement.textContent.trim() : null;
            
            return {
                nickname: displayName || 'Unknown',
                profileImage: profileImage
            };
        }
    }
    
    return {
        nickname: 'Unknown',
        profileImage: null
    };
}

// 채팅창에 정답자 표시하는 함수
function displayCorrectUsersInChat(correctUsers) {
    const chatLog = document.getElementById('chatLog'); // chatBox → chatLog로 변경
    if (!chatLog) return;

    if (correctUsers && correctUsers.length > 0) {
        // 객관식 정답자들도 Set에 추가하고 초록색 테두리 적용
        correctUsers.forEach(nickname => {
            correctUsersThisQuestion.add(nickname);
            const scoreboardItem = document.querySelector(`#scoreboard li[data-nickname="${nickname}"]`);
            if (scoreboardItem) {
                scoreboardItem.classList.remove('border-blue-400');
                scoreboardItem.classList.add('border-green-500');
            }
        });

        // 정답자가 있는 경우
        const correctUsersMessage = document.createElement('div');
        correctUsersMessage.className = 'mb-4 p-4 bg-blue-900/30 border-2 border-blue-400/50 rounded-xl';
        correctUsersMessage.innerHTML = `
            <div class="text-center">
                <h4 class="text-blue-400 font-bold mb-2">정답자 ${correctUsers.length}명</h4>
                <div class="flex flex-wrap justify-center gap-2">
                    ${correctUsers.map(user => `
                        <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-500/30 text-blue-200 border border-blue-400/50">
                            ${user}
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
        chatLog.appendChild(correctUsersMessage);
        chatLog.scrollTop = chatLog.scrollHeight; // 스크롤 추가
    } else {
        // 정답자가 없는 경우
        const noCorrectMessage = document.createElement('div');
        noCorrectMessage.className = 'mb-4 p-4 bg-gray-800/50 border-2 border-gray-600 rounded-xl text-center';
        noCorrectMessage.innerHTML = `
            <p class="text-gray-400">아무도 정답을 맞히지 못했습니다</p>
        `;
        chatLog.appendChild(noCorrectMessage);
        chatLog.scrollTop = chatLog.scrollHeight; // 스크롤 추가
    }
}

// 객관식 문제 키보드 선택 핸들러
function handleChoiceKeyPress(e) {
    // 입력 필드에 포커스가 있으면 무시
    if (document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA') {
        return;
    }
    
    // 1-9 숫자 키 처리
    const key = e.key;
    if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1;
        const buttons = document.querySelectorAll('.choice-btn');
        
        if (buttons[index] && !buttons[index].disabled) {
            // 해당 버튼 클릭
            buttons[index].click();
            
            // 시각적 피드백 (약간의 애니메이션)
            buttons[index].classList.add('scale-95');
            setTimeout(() => {
                buttons[index].classList.remove('scale-95');
            }, 100);
        }
    }
}

// 유튜브 비디오 ID 추출 (쇼츠 지원)
function extractYoutubeVideoId(url) {
    if (!url) return null;

    // 유튜브 쇼츠 패턴 먼저 확인 (예: youtube.com/shorts/VIDEO_ID)
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];

    // 기존 정규식 (일반 유튜브 URL)
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
}

function showAnswerWithYoutube({ answers, answerImageBase64, revealedAt, index }) {
    const box = document.getElementById('questionBox');

    if (questionTimer) clearTimeout(questionTimer);
    if (countdownInterval) clearInterval(countdownInterval);

    // ✅ 이전 문제의 유튜브 플레이어 즉시 정리 (백그라운드 재생 방지)
    if (youtubePlayer) {
        try {
            youtubePlayer.stopVideo();
            youtubePlayer.destroy();
        } catch (error) {
            console.error('유튜브 플레이어 정지 실패:', error);
        }
        youtubePlayer = null;
    }

    // 힌트 숨기기
    const hintDisplay = document.getElementById('hintDisplay');
    if (hintDisplay) {
        hintDisplay.classList.add('hidden');
    }

    const displayAnswer = Array.isArray(answers) ? answers[0] : answers;

    let html = `
        <div class="bg-green-500/20 border-green-400 rounded-xl p-4 mb-3">
            <h3 class="font-bold text-green-400 mb-2">정답</h3>
            <div class="text-white">
                ${displayAnswer}
            </div>
        </div>
    `;

    // 정답 이미지
    if (answerImageBase64) {
        html += `
            <div class="mb-4">
                <img src="${answerImageBase64}" 
                     alt="정답 이미지" 
                     class="w-auto h-auto max-h-[300px] mx-auto rounded-lg shadow-lg">
            </div>
        `;
    }

    // 정답 유튜브 영상
    const question = questions[index];
    if (question && question.answerYoutubeUrl) {
        const videoId = extractYoutubeVideoId(question.answerYoutubeUrl);
        const startTime = question.answerYoutubeStartTime || 0;
        
        if (videoId) {
            html += `
                <div class="mb-4">
                    <div class="youtube-player-wrapper max-w-2xl mx-auto">
                        <div class="relative" style="padding-bottom: 56.25%; height: 0;">
                            <!-- YouTube 플레이어가 여기에 생성됨 -->
                            <div id="youtubePlayerAnswer" class="absolute top-0 left-0 w-full h-full rounded-lg"></div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    box.innerHTML = html;

    // 정답 유튜브 영상이 있으면 플레이어 생성
    if (question && question.answerYoutubeUrl) {
        const videoId = extractYoutubeVideoId(question.answerYoutubeUrl);
        const startTime = question.answerYoutubeStartTime || 0;
        
        if (videoId) {
            setTimeout(() => {
                createYoutubePlayer(videoId, startTime, 0, 'youtubePlayerAnswer');
            }, 100);
        }
    }

    window.__isRevealingAnswer = true;
    currentRevealedAt = revealedAt ? new Date(revealedAt) : new Date();

    // 기존 타이머가 있으면 취소
    if (nextQuestionTimer) {
        clearTimeout(nextQuestionTimer);
    }

    // 5초 후 다음 문제로 넘어가기 (서버 시간 차이를 고려하지 않고 정확히 5초)
    // ✅ currentIndex 클로저 캡처 (타이머 실행 시점에 바뀔 수 있음)
    const questionIndexAtReveal = currentIndex;
    nextQuestionTimer = setTimeout(() => {
        window.__isRevealingAnswer = false;
        currentRevealedAt = null;
        nextQuestionTimer = null;
        if (isHost()) {
            socket.emit('nextQuestion', {
                sessionId,
                userId,
                questionIndex: questionIndexAtReveal
            });
        }
    }, 5000);
}

function startCountdown(timeLimit) {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    const timerDisplay = document.getElementById('timerDisplay');
    const hintDisplay = document.getElementById('hintDisplay');
    const hintText = document.getElementById('hintText');
    let remaining = timeLimit;

    // 힌트 표시 숨김 (새 문제 시작)
    if (hintDisplay) {
        hintDisplay.classList.add('hidden');
    }

    if (timerDisplay) {
        timerDisplay.textContent = `남은 시간: ${remaining}초`;
    }

    // 현재 문제의 힌트 정보 가져오기
    const actualIndex = questionOrder[currentIndex];
    const currentQuestion = questions[actualIndex];
    const hint = currentQuestion?.hint;
    const hintShowTime = currentQuestion?.hintShowTime || 10;

    countdownInterval = setInterval(() => {
        remaining--;
        if (timerDisplay) {
            timerDisplay.textContent = `남은 시간: ${remaining}초`;
        }

        // 힌트 표시 조건: 힌트가 있고, 남은 시간이 설정한 시간 이하일 때
        if (hint && remaining <= hintShowTime && remaining > 0 && hintDisplay && hintText) {
            hintText.textContent = hint;
            hintDisplay.classList.remove('hidden');
        }

        if (remaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }, 1000);
}

// YouTube API 준비 완료 콜백
window.onYouTubeIframeAPIReady = function() {
    console.log('YouTube IFrame API 준비 완료');
};

// 유튜브 플레이어 생성 함수
function createYoutubePlayer(videoId, startTime, endTime, elementId) {
    // YouTube API가 로드되었는지 확인
    if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
        setTimeout(() => {
            createYoutubePlayer(videoId, startTime, endTime, elementId);
        }, 500);
        return;
    }

    // 타겟 엘리먼트가 존재하는지 확인
    const targetElement = document.getElementById(elementId);
    if (!targetElement) {
        return;
    }

    // 기존 플레이어 제거
    if (youtubePlayer) {
        youtubePlayer.destroy();
        youtubePlayer = null;
    }

    // 새 플레이어 생성
    youtubePlayer = new YT.Player(elementId, {
        videoId: videoId,
        playerVars: {
            autoplay: 1,
            start: startTime,
            end: endTime > 0 ? endTime : undefined,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3
        },
        events: {
            onReady: function(event) {
                // 자동 재생을 위해 먼저 음소거 후 재생
                event.target.mute();
                event.target.playVideo();

                // 재생이 시작되면 음소거 해제하고 볼륨 설정
                setTimeout(() => {
                    event.target.unMute();
                    event.target.setVolume(globalYoutubeVolume);
                }, 100);
            },
            onStateChange: function(event) {
                // UNSTARTED 상태에서 재생 재시도
                if (event.data === -1) {
                    setTimeout(() => {
                        event.target.playVideo();
                    }, 500);
                }

                if (event.data === YT.PlayerState.ENDED) {
                    event.target.seekTo(startTime);
                    event.target.playVideo();
                }
            }
        }
    });
}

// 볼륨 설정 함수 (실시간 적용)
function setYoutubeVolume(volume) {
    globalYoutubeVolume = parseInt(volume);
    
    // 화면 표시 업데이트
    const volumePercent = document.getElementById('volumePercent');
    if (volumePercent) {
        volumePercent.textContent = `${globalYoutubeVolume}%`;
    }
    
    // YouTube 플레이어에 즉시 적용
    if (youtubePlayer && youtubePlayer.setVolume) {
        youtubePlayer.setVolume(globalYoutubeVolume);
    }
    
    // localStorage에 저장
    localStorage.setItem('youtubeVolume', globalYoutubeVolume);
}

// 저장된 볼륨 불러오기
function loadSavedVolume() {
    const savedVolume = localStorage.getItem('youtubeVolume');
    if (savedVolume !== null) {
        globalYoutubeVolume = parseInt(savedVolume);
    }
}

// 초기화
loadSavedVolume();


// 전역 함수로 등록 (HTML onclick에서 사용)
window.toggleCodeVisibility = toggleCodeVisibility;
window.copyInviteCode = copyInviteCode;
window.selectChoice = selectChoice;
window.currentSendFunction = () => currentSendFunction();
window.currentWaitingSendFunction = () => currentWaitingSendFunction();
window.handleChoiceKeyPress = handleChoiceKeyPress;
window.extractYoutubeVideoId = extractYoutubeVideoId;
window.setYoutubeVolume = setYoutubeVolume;
window.createYoutubePlayer = createYoutubePlayer;

// 페이지 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);
