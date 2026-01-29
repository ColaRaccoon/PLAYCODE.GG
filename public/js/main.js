// js/main.js

import { renderNavbar, getUserData, highlightCurrentPage } from './navbar.js';
import { renderFooter } from './footer.js';
import { renderMobileAd } from './mobile-ad.js';
import {
  getGuestNickname,
  setGuestNickname,
  setGuestId,
  showNicknameModal
} from './guestNicknameHelper.js';

let allQuizzes = [];
let currentPage = 1;
let currentSearchTerm = '';
let currentSortOrder = 'popular';
let isLoading = false;
let hasMore = true;

let currentQuizId = null;

// 드롭다운 토글 함수 (데스크톱)
function toggleSortDropdown() {
    const dropdown = document.getElementById('sortDropdown');
    dropdown.classList.toggle('hidden');
}

// 드롭다운 토글 함수 (모바일)
function toggleSortDropdownMobile() {
    const dropdown = document.getElementById('sortDropdownMobile');
    dropdown.classList.toggle('hidden');
}

// 정렬 선택 (데스크톱)
function selectSort(sortOrder) {
    const dropdown = document.getElementById('sortDropdown');
    dropdown.classList.add('hidden');
    changeSortOrder(sortOrder);
}

// 정렬 선택 (모바일)
function selectSortMobile(sortOrder) {
    const dropdown = document.getElementById('sortDropdownMobile');
    dropdown.classList.add('hidden');
    changeSortOrder(sortOrder);
}

// 드롭다운 외부 클릭 시 닫기
document.addEventListener('click', function(event) {
    const sortButton = document.getElementById('sortButton');
    const sortButtonMobile = document.getElementById('sortButtonMobile');
    const sortDropdown = document.getElementById('sortDropdown');
    const sortDropdownMobile = document.getElementById('sortDropdownMobile');

    if (sortButton && sortDropdown && !sortButton.contains(event.target) && !sortDropdown.contains(event.target)) {
        sortDropdown.classList.add('hidden');
    }

    if (sortButtonMobile && sortDropdownMobile && !sortButtonMobile.contains(event.target) && !sortDropdownMobile.contains(event.target)) {
        sortDropdownMobile.classList.add('hidden');
    }
});

// 초대 코드로 게임 참여 (게스트 지원)
async function joinByInvite() {
    // 데스크톱과 모바일 양쪽에서 값 가져오기
    const desktopInput = document.getElementById('inviteInput');
    const mobileInput = document.getElementById('inviteInputMobile');

    const code = (desktopInput?.value || mobileInput?.value || '').trim();

    if (!code) {
        alert('초대 코드를 입력하세요');
        return;
    }

    try {
        // 먼저 로그인 사용자로 시도
        let response = await fetch('/game/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-requested-with': 'XMLHttpRequest'
            },
            body: JSON.stringify({ inviteCode: code }),
            credentials: 'include'
        });

        // 401 에러: 게스트로 처리
        if (response.status === 401) {
            // 게스트 닉네임 가져오기 또는 입력 받기
            let guestNickname = getGuestNickname();

            if (!guestNickname) {
                guestNickname = await showNicknameModal();
                setGuestNickname(guestNickname);
            }

            // 게스트로 참여 재시도
            response = await fetch('/game/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-requested-with': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    inviteCode: code,
                    guestNickname: guestNickname
                }),
                credentials: 'include'
            });
        }

        const result = await response.json();

        if (response.ok) {
            // 게스트 ID 저장 (게스트인 경우)
            if (result.guestId) {
                setGuestId(result.guestId);
            }

            window.location.href = `/quiz/${result.sessionId}`;
        } else {
            console.error('게임 참여 실패:', result.message);
            alert(result.message || '입장에 실패했습니다. 코드를 다시 확인해주세요.');
        }
    } catch (err) {
        console.error('Join session error:', err);
        alert('입장 중 오류가 발생했습니다.');
    }
}

async function changeSortOrder(newSortOrder) {
    currentSortOrder = newSortOrder;
    currentPage = 1;
    hasMore = true;
    allQuizzes = [];

    const quizListContainer = document.getElementById('quizList');
    quizListContainer.innerHTML = `
        <div class="text-center py-8 col-span-full">
            <div class="inline-flex items-center space-x-2 text-gray-500">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500"></div>
                <span>퀴즈 목록을 정렬하는 중...</span>
            </div>
        </div>
    `;

    await loadQuizzes();
}

// 검색 이벤트 리스너 설정
function setupSearchListener() {
    // 데스크톱 검색
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    // 모바일 검색
    const searchInputMobile = document.getElementById('searchInputMobile');
    const searchBtnMobile = document.getElementById('searchBtnMobile');
    
    // 통합 검색 함수
    const performSearch = (inputElement) => {
        if (inputElement) {
            searchQuizzes(inputElement.value);
        }
    };
    
    // 데스크톱 이벤트
    if (searchBtn) {
        searchBtn.addEventListener('click', () => performSearch(searchInput));
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch(searchInput);
            }
        });
    }
    
    // 모바일 이벤트
    if (searchBtnMobile) {
        searchBtnMobile.addEventListener('click', () => performSearch(searchInputMobile));
    }
    
    if (searchInputMobile) {
        searchInputMobile.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch(searchInputMobile);
            }
        });
    }
}

// 검색 실행 함수
async function searchQuizzes(searchTerm) {
    currentSearchTerm = searchTerm;
    currentPage = 1;
    hasMore = true;
    allQuizzes = [];
    
    // 양쪽 검색창에 같은 값 동기화
    const desktopInput = document.getElementById('searchInput');
    const mobileInput = document.getElementById('searchInputMobile');
    
    if (desktopInput) desktopInput.value = searchTerm;
    if (mobileInput) mobileInput.value = searchTerm;
    
    const quizListContainer = document.getElementById('quizList');
    quizListContainer.innerHTML = `
        <div class="text-center py-8 col-span-full">
            <div class="inline-flex items-center space-x-2 text-gray-500">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500"></div>
                <span>검색 중...</span>
            </div>
        </div>
    `;
    
    await loadQuizzes();
}

// 통합된 퀴즈 로딩 함수
async function loadQuizzes() {
    if (isLoading || !hasMore) return;

    isLoading = true;

    try {
        let url;
        if (currentSearchTerm) {
            url = `/api/quiz/search?q=${encodeURIComponent(currentSearchTerm)}&page=${currentPage}&limit=20&sort=${currentSortOrder}`;
        } else {
            url = `/api/quiz/list?page=${currentPage}&limit=20&sort=${currentSortOrder}`;
        }

        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json();
        
        if (response.ok) {
            if (currentPage === 1) {
                allQuizzes = data.quizzes || [];
            } else {
                allQuizzes = [...allQuizzes, ...(data.quizzes || [])];
            }
            
            hasMore = data.hasMore || false;
            renderQuizList(allQuizzes);
            
            if (currentPage === 1) {
                setupInfiniteScroll();
            }
        } else {
            throw new Error('퀴즈 목록을 불러오지 못했습니다.');
        }
    } catch (err) {
        console.error('퀴즈 로딩 실패:', err);
        const quizListContainer = document.getElementById('quizList');
        quizListContainer.innerHTML = `
            <div class="text-center py-8 col-span-full">
                <p class="text-gray-500">퀴즈 목록을 불러올 수 없습니다.</p>
                <button onclick="loadQuizList()" class="mt-2 text-blue-400 hover:text-blue-300">
                    다시 시도
                </button>
            </div>
        `;
    } finally {
        isLoading = false;
    }
}

// 다음 페이지 로딩
async function loadMoreQuizzes() {
    if (isLoading || !hasMore) return;
    
    currentPage++;
    await loadQuizzes();
}

// 무한 스크롤 설정
function setupInfiniteScroll() {
    window.removeEventListener('scroll', handleScroll);
    window.addEventListener('scroll', handleScroll);
}

// 스크롤 핸들러
function handleScroll() {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000) {
        loadMoreQuizzes();
    }
}

// 퀴즈 목록 초기 로딩
async function loadQuizList() {
    const quizListContainer = document.getElementById('quizList');
    if (!quizListContainer) {
        console.error('quizList 컨테이너를 찾을 수 없습니다');
        return;
    }

    quizListContainer.innerHTML = `
        <div class="text-center py-8 col-span-full">
            <div class="inline-flex items-center space-x-2 text-gray-500">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500"></div>
                <span>퀴즈 목록을 불러오는 중...</span>
            </div>
        </div>
    `;

    currentPage = 1;
    currentSearchTerm = '';
    currentSortOrder = 'popular';
    hasMore = true;
    allQuizzes = [];

    try {
        await loadQuizzes();
        setupSearchListener();
    } catch (err) {
        console.error('퀴즈 목록 불러오기 실패:', err);
        quizListContainer.innerHTML = `
            <div class="text-center py-8 col-span-full">
                <p class="text-gray-500">퀴즈 목록을 불러올 수 없습니다.</p>
                <button onclick="loadQuizList()" class="mt-2 text-blue-400 hover:text-blue-300">
                    다시 시도
                </button>
            </div>
        `;
    }
}

// 퀴즈 목록 렌더링
function renderQuizList(quizzes) {
    const quizListContainer = document.getElementById('quizList');
    if (!quizListContainer) return;

    if (quizzes.length === 0) {
        quizListContainer.innerHTML = `
            <div class="text-center py-8 col-span-full">
                <p class="text-gray-500">등록된 퀴즈가 없습니다.</p>
            </div>
        `;
        return;
    }

    const quizHTML = quizzes.map(quiz => `
        <div class="quiz-card bg-white rounded-lg shadow-md overflow-hidden cursor-pointer" onclick="openQuizModal('${quiz._id}')">
            <div class="relative">
                ${quiz.titleImageBase64 ?
                    `<img src="${quiz.titleImageBase64}" alt="${quiz.title}" class="quiz-card-img w-full h-48 object-cover">` :
                    `<div class="quiz-card-img w-full h-48 bg-gradient-to-br from-blue-400 via-purple-500 to-pink-500 flex items-center justify-center">
                        <span class="text-white text-4xl font-bold">Q</span>
                    </div>`
                }
            </div>
            <div class="p-5 quiz-card-content">
                <div class="font-bold text-[15px] mb-2 text-gray-800 truncate text-left" title="${quiz.title}">${quiz.title}</div>
                <p class="text-gray-600 text-[15px] mb-3 line-clamp-2 min-h-[2.5rem] text-left">${quiz.description || '퀴즈에 도전해보세요!'}</p>
                <div class="quiz-card-info flex justify-between items-center text-xs text-gray-500 mb-2">
                    <div class="flex items-center space-x-1 truncate">
                        <span>플레이:</span>
                        <span>${quiz.completedGameCount || 0}회</span>
                    </div>
                    <span class="truncate ml-2">생성일: ${new Date(quiz.createdAt).toLocaleDateString('ko-KR')}</span>
                </div>
                <div class="flex items-center text-xs text-gray-600 pt-2 border-t border-gray-200">
                    <span class="truncate" title="${quiz.creatorNickname || '알 수 없음'}">제작자: ${quiz.creatorNickname || '알 수 없음'}</span>
                </div>
            </div>
        </div>
    `).join('');

    const loadingMessage = hasMore && isLoading ? `
        <div class="text-center py-4 col-span-full">
            <div class="inline-flex items-center space-x-2 text-gray-500">
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400"></div>
                <span>더 많은 퀴즈를 불러오는 중...</span>
            </div>
        </div>
    ` : '';

    quizListContainer.innerHTML = quizHTML + loadingMessage;
}

// 페이지 UI 업데이트
function updatePageUI(user) {
    const desktopInviteSection = document.getElementById('inviteSection');
    const mobileInviteSection = document.getElementById('inviteSectionMobile');

    loadQuizList();

    // 로그인 여부와 관계없이 초대 코드 입력란은 항상 표시 (게스트도 참여 가능)
    if (desktopInviteSection) desktopInviteSection.classList.remove('hidden');
    if (mobileInviteSection) mobileInviteSection.classList.remove('hidden');
}

// 이벤트 리스너 설정
function attachEventListeners() {
    // 데스크톱 초대 버튼
    const joinBtn = document.getElementById('joinBtn');
    const inviteInput = document.getElementById('inviteInput');
    
    // 모바일 초대 버튼
    const joinBtnMobile = document.getElementById('joinBtnMobile');
    const inviteInputMobile = document.getElementById('inviteInputMobile');

    if (joinBtn) {
        joinBtn.addEventListener('click', joinByInvite);
    }

    if (joinBtnMobile) {
        joinBtnMobile.addEventListener('click', joinByInvite);
    }

    // Enter 키로 참여 가능
    if (inviteInput) {
        inviteInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                joinByInvite();
            }
        });
    }

    if (inviteInputMobile) {
        inviteInputMobile.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                joinByInvite();
            }
        });
    }
}

// 페이지 초기화
async function initializePage() {
    try {
        const user = await renderNavbar();
        highlightCurrentPage();

        // 모바일 광고 렌더링
        await renderMobileAd();

        // 푸터 렌더링
        await renderFooter();

        updatePageUI(user);
        attachEventListeners();

        // URL 파라미터로 퀴즈 ID가 있으면 자동으로 모달 열기
        const urlParams = new URLSearchParams(window.location.search);
        const quizId = urlParams.get('quiz');
        if (quizId) {
            // updateURL = false (이미 URL에 있으므로 다시 추가하지 않음)
            openQuizModal(quizId, false);
        }

        // 브라우저 뒤로가기/앞으로가기 처리
        window.addEventListener('popstate', (event) => {
            const urlParams = new URLSearchParams(window.location.search);
            const quizId = urlParams.get('quiz');

            if (quizId) {
                // URL에 퀴즈 ID 있음 → 모달 열기
                openQuizModal(quizId, false);
            } else {
                // URL에 퀴즈 ID 없음 → 모달 닫기
                const modal = document.getElementById('quizModal');
                if (!modal.classList.contains('hidden')) {
                    closeQuizModal(false);
                }
            }
        });
    } catch (err) {
        console.error('페이지 초기화 실패:', err);
        updatePageUI(null);
        attachEventListeners();
    }
}

// 퀴즈 카드 클릭 시 모달 열기
async function openQuizModal(quizId, updateURL = true) {
    currentQuizId = quizId;

    try {
        const response = await fetch(`/api/quiz/${quizId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                alert('로그인이 필요합니다.');
                window.location.href = '/login';
                return;
            }
            const errorData = await response.json().catch(() => ({}));
            console.error('서버 에러 응답:', errorData);
            throw new Error(errorData.message || '퀴즈 정보를 불러올 수 없습니다.');
        }

        const quiz = await response.json();
        updateModalContent(quiz); // quiz 객체 전달 (isComplete 포함)
        showModal();

        // URL에 퀴즈 ID 추가 (History API)
        if (updateURL) {
            const url = new URL(window.location);
            url.searchParams.set('quiz', quizId);
            window.history.pushState({ quizId }, '', url);
        }

    } catch (error) {
        console.error('퀴즈 정보 로딩 실패:', error);
        alert('퀴즈 정보를 불러오는 중 오류가 발생했습니다: ' + error.message);
    }
}

// 모달 내용 업데이트
function updateModalContent(quiz) {
    const modalThumbnail = document.getElementById('modalThumbnail');
    const thumbnailContainer = modalThumbnail.parentElement;

    if (quiz.titleImageBase64) {
        modalThumbnail.src = quiz.titleImageBase64;
        modalThumbnail.alt = quiz.title;
        modalThumbnail.style.display = 'block';
        thumbnailContainer.classList.remove('bg-gradient-to-br', 'from-blue-400', 'via-purple-500', 'to-pink-500');
    }

    const modalPlayBadge = document.getElementById('modalPlayBadge');
    if (quiz.completedGameCount > 0) {
        modalPlayBadge.textContent = `누적 플레이 ${quiz.completedGameCount}회!`;
        modalPlayBadge.className = 'absolute top-4 left-4 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-bold';
    } else {
        modalPlayBadge.textContent = 'NEW';
        modalPlayBadge.className = 'absolute top-4 left-4 bg-gray-500 text-white px-3 py-1 rounded-full text-sm font-bold';
    }

    document.getElementById('modalTitle').textContent = quiz.title;

    const createdDate = new Date(quiz.createdAt).toLocaleDateString('ko-KR').replace(/\.$/, '');
    document.getElementById('modalCreatedDate').textContent = `${createdDate}`;

    const description = quiz.description || '이 퀴즈에 도전해보세요!';
    document.getElementById('modalDescription').textContent = description;

    // 비공개 퀴즈 처리
    const createBtn = document.getElementById('createSessionBtn');
    if (!quiz.isComplete) {
        // 비공개 퀴즈: 버튼 비활성화 및 메시지 변경
        createBtn.disabled = true;
        createBtn.className = 'w-full bg-gray-400 text-white font-bold py-4 px-6 rounded-xl cursor-not-allowed shadow-lg';
        createBtn.innerHTML = '비공개 퀴즈 (플레이 불가)';
    } else {
        // 공개 퀴즈: 정상 활성화
        createBtn.disabled = false;
        createBtn.className = 'w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl';
        createBtn.innerHTML = '게임 세션 만들기';
    }
}

// ESC 키 핸들러
function handleEscapeKey(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
        closeQuizModal();
    }
}

// 모달 표시 애니메이션
function showModal() {
    const modal = document.getElementById('quizModal');
    const modalContent = document.getElementById('quizModalContent');

    modal.classList.remove('hidden');

    setTimeout(() => {
        modalContent.classList.remove('scale-95', 'opacity-0');
        modalContent.classList.add('scale-100', 'opacity-100');
    }, 10);

    document.body.style.overflow = 'hidden';

    // ESC 키 리스너 추가
    document.addEventListener('keydown', handleEscapeKey);
}

// 모달 닫기
function closeQuizModal(updateURL = true) {
    const modal = document.getElementById('quizModal');
    const modalContent = document.getElementById('quizModalContent');

    modalContent.classList.remove('scale-100', 'opacity-100');
    modalContent.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        currentQuizId = null;
    }, 300);

    document.body.style.overflow = 'auto';

    // ESC 키 리스너 제거
    document.removeEventListener('keydown', handleEscapeKey);

    // URL에서 퀴즈 ID 제거
    if (updateURL) {
        const url = new URL(window.location);
        url.searchParams.delete('quiz');
        window.history.pushState({}, '', url);
    }
}

// 게임 세션 생성 (게스트 지원)
async function createGameSession() {
    if (!currentQuizId) {
        alert('퀴즈 정보를 찾을 수 없습니다.');
        return;
    }

    const createBtn = document.getElementById('createSessionBtn');
    const originalText = createBtn.innerHTML;

    createBtn.innerHTML = '세션 생성 중...';
    createBtn.disabled = true;

    try {
        // 먼저 로그인 사용자로 시도
        let response = await fetch('/game/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ quizId: currentQuizId }),
            credentials: 'include'
        });

        // 401 에러: 게스트로 처리
        if (response.status === 401) {
            // 게스트 닉네임 가져오기 또는 입력 받기
            let guestNickname = getGuestNickname();

            if (!guestNickname) {
                // ✅ currentQuizId를 임시 변수에 저장 (closeQuizModal이 null로 초기화하기 때문)
                const savedQuizId = currentQuizId;

                // 로딩 상태 해제
                createBtn.innerHTML = originalText;
                createBtn.disabled = false;

                // 게임 상세보기 모달 먼저 닫기 (스타일 충돌 방지)
                closeQuizModal();

                guestNickname = await showNicknameModal();
                setGuestNickname(guestNickname);

                // ✅ currentQuizId 복구
                currentQuizId = savedQuizId;

                // 다시 로딩 상태로 (하지만 모달이 닫혀있으므로 의미없음, 직접 진행)
                // createBtn.innerHTML = '세션 생성 중...';
                // createBtn.disabled = true;
            }

            // 게스트로 세션 생성 재시도
            response = await fetch('/game/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    quizId: currentQuizId,
                    guestNickname: guestNickname
                }),
                credentials: 'include'
            });
        }

        if (!response.ok) {
            // 서버 에러 응답 상세 로깅
            const errorData = await response.json().catch(() => ({}));
            console.error('서버 응답 에러:', {
                status: response.status,
                statusText: response.statusText,
                errorData: errorData
            });
            throw new Error(errorData.message || '게임 세션 생성에 실패했습니다.');
        }

        const data = await response.json();

        // 게스트 ID 저장 (게스트인 경우)
        if (data.guestId) {
            setGuestId(data.guestId);
        }

        if (data.sessionId) {
            closeQuizModal();
            window.location.href = `/quiz/${data.sessionId}`;
        } else {
            throw new Error('세션 ID를 받지 못했습니다.');
        }

    } catch (error) {
        console.error('게임 세션 생성 실패:', error);
        alert(error.message || '게임 세션을 생성하는 중 오류가 발생했습니다.');
    } finally {
        createBtn.innerHTML = originalText;
        createBtn.disabled = false;
    }
}

// 퀴즈 공유하기 (링크 복사)
async function shareQuiz() {
    if (!currentQuizId) {
        alert('퀴즈 정보를 찾을 수 없습니다.');
        return;
    }

    try {
        // 공유 URL 생성
        const shareUrl = `${window.location.origin}/?quiz=${currentQuizId}`;

        // 클립보드에 복사
        await navigator.clipboard.writeText(shareUrl);

        // 버튼 피드백
        const shareBtn = document.getElementById('shareQuizBtn');
        const originalHTML = shareBtn.innerHTML;
        const originalBg = shareBtn.className;

        // 성공 표시
        shareBtn.innerHTML = `
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
        `;
        shareBtn.className = shareBtn.className.replace('hover:bg-green-500', 'bg-green-500');

        // 2초 후 원래대로
        setTimeout(() => {
            shareBtn.innerHTML = originalHTML;
            shareBtn.className = originalBg;
        }, 2000);

        // 간단한 토스트 메시지
        alert('퀴즈 링크가 클립보드에 복사되었습니다!');

    } catch (error) {
        console.error('링크 복사 실패:', error);

        // 클립보드 API 지원 안되는 경우 대체 방법
        const shareUrl = `${window.location.origin}/?quiz=${currentQuizId}`;
        prompt('아래 링크를 복사하세요:', shareUrl);
    }
}

// 퀴즈 신고하기
async function reportQuiz() {
    if (!currentQuizId) {
        alert('퀴즈 정보를 찾을 수 없습니다.');
        return;
    }

    // 신고 사유 입력받기
    const reason = prompt('신고 사유를 입력해주세요:\n\n(예: 부적절한 내용, 저작권 침해, 혐오 표현 등)');

    // 취소 버튼을 누르면 null이 반환됨
    if (reason === null) {
        return;
    }

    // 빈 문자열 체크
    if (!reason || reason.trim().length === 0) {
        alert('신고 사유를 입력해주세요.');
        return;
    }

    const reportBtn = document.getElementById('reportQuizIconBtn');

    reportBtn.disabled = true;
    reportBtn.style.opacity = '0.5';
    reportBtn.style.cursor = 'not-allowed';

    try {
        const response = await fetch(`/api/quiz/${currentQuizId}/report`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason: reason.trim() }),
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok) {
            alert('신고가 접수되었습니다. 관리자가 검토 후 조치할 예정입니다.');
            closeQuizModal();
        } else {
            if (response.status === 401) {
                alert('로그인이 필요합니다.');
                window.location.href = '/login';
                return;
            }
            alert(data.message || '신고 처리 중 오류가 발생했습니다.');
        }

    } catch (error) {
        console.error('퀴즈 신고 실패:', error);
        alert('신고 처리 중 오류가 발생했습니다.');
    } finally {
        reportBtn.disabled = false;
        reportBtn.style.opacity = '1';
        reportBtn.style.cursor = 'pointer';
    }
}

// 전역 함수로 등록 (HTML onclick에서 사용)
window.openQuizModal = openQuizModal;
window.closeQuizModal = closeQuizModal;
window.createGameSession = createGameSession;
window.shareQuiz = shareQuiz;
window.reportQuiz = reportQuiz;
window.loadQuizList = loadQuizList;
window.joinByInvite = joinByInvite;
window.changeSortOrder = changeSortOrder;
window.toggleSortDropdown = toggleSortDropdown;
window.toggleSortDropdownMobile = toggleSortDropdownMobile;
window.selectSort = selectSort;
window.selectSortMobile = selectSortMobile;

// 페이지 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);