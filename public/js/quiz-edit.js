// quiz-edit.js
import { renderNavbar, highlightCurrentPage } from './navbar.js';
import { resizeImageToBlob, uploadToS3WithPresignedUrl } from './quiz-init-modal.js';
import { fetchWithAuth } from './quiz-init-modal.js';
import { renderFooter } from './footer.js';
import { renderMobileAd } from './mobile-ad.js';

// 전역 변수
let currentView = 'overview';
let questions = [];
let currentQuiz = null; // 퀴즈 정보 저장
let currentEditingIndex = null;
let currentAnswers = [];
let currentIncorrects = [];
let currentQuestionType = 'text'; // 'text', 'image', 'video', 'audio'
let questionImageFile = null; // File 객체 저장
let answerImageFile = null; // File 객체 저장
const quizId = new URLSearchParams(window.location.search).get('quizId');

// 자동 저장 관련 변수
let autoSaveTimeout = null;
let isSavingAuto = false;

// 문제 타입 자동 감지 (기존 문제용)
function detectQuestionType(question) {
    if (question.questionType) {
        return question.questionType;
    }
    
    if (question.imageBase64) {
        return 'image';
    } else if (question.youtubeUrl) {
        // 기존 로직에서는 구분이 없으므로 기본값으로 'video'
        return 'video';
    } else {
        return 'text';
    }
}

// 네비바 렌더링
async function initNavbar() {
    const user = await renderNavbar();
    highlightCurrentPage();

    // 모바일 광고 렌더링
    await renderMobileAd();

    if (!user) {
        window.location.href = '/login?message=' + encodeURIComponent('로그인이 필요합니다.');
        return false;
    }
    return true;
}

// 문제 타입 선택 함수 (버튼 클릭 시 호출)
export function selectQuestionType(type) {
    const previousType = currentQuestionType;
    currentQuestionType = type; // 전역 변수 업데이트

    // 타입이 변경되면 이전 타입의 데이터 정리
    if (previousType !== type) {
        // 텍스트나 영상/소리로 변경 시 이미지 데이터 초기화
        if ((previousType === 'image') && (type === 'text' || type === 'video' || type === 'audio')) {
            questionImageFile = null;
            answerImageFile = null;
            document.getElementById('questionImagePreview')?.classList.add('hidden');
            document.getElementById('answerImagePreview')?.classList.add('hidden');
            document.getElementById('questionImage').value = '';
            document.getElementById('answerImage').value = '';
        }

        // 텍스트나 이미지로 변경 시 유튜브 데이터 초기화
        if ((previousType === 'video' || previousType === 'audio') && (type === 'text' || type === 'image')) {
            document.getElementById('youtubeUrl').value = '';
            document.getElementById('startTime').value = '';
            document.getElementById('endTime').value = '';
            document.getElementById('answerYoutubeUrl').value = '';
            document.getElementById('answerStartTime').value = '';
            document.getElementById('youtubePreview')?.classList.add('hidden');
            document.getElementById('answerYoutubePreview')?.classList.add('hidden');
        }
    }

    // 모든 버튼의 스타일 초기화
    document.querySelectorAll('[data-question-type]').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'ring-2', 'ring-blue-400');
        btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
    });

    // 선택된 버튼 활성화 스타일 적용
    const selectedButton = document.querySelector(`[data-question-type="${type}"]`);
    if (selectedButton) {
        selectedButton.classList.remove('bg-gray-700', 'hover:bg-gray-600');
        selectedButton.classList.add('bg-blue-600', 'ring-2', 'ring-blue-400');
    }

    // 타입에 따른 폼 표시/숨김
    updateFormVisibility();

    // 타입이 변경되었으면 자동 저장 트리거
    if (previousType !== type && currentEditingIndex !== null) {
        triggerAutoSave();
    }
}

// 폼 표시 업데이트 함수
function updateFormVisibility() {
    const isMultipleChoice = document.getElementById('isMultipleChoice')?.checked || false;
    
    // 모든 섹션 요소 가져오기
    const sections = {
        questionText: document.getElementById('questionTextSection'),
        questionImage: document.getElementById('questionImageSection'),
        youtube: document.getElementById('youtubeSection'),
        answerText: document.getElementById('answerTextSection'),
        answerImage: document.getElementById('answerImageSection'),
        answerYoutube: document.getElementById('answerYoutubeSection'),
        incorrect: document.getElementById('incorrectSection'),
    };
    
    // 디버깅: 어떤 섹션이 없는지 확인
    Object.entries(sections).forEach(([key, element]) => {
        if (!element && IS_DEV_MODE) {
            console.warn(`${key} 섹션을 찾을 수 없습니다`);
        }
    });
    
    // 모든 섹션 숨김 (초기화)
    Object.values(sections).forEach(section => {
        if (section) section.style.display = 'none';
    });
    
    
    // 문제 타입별로 표시할 섹션 결정
    switch(currentQuestionType) {
        case 'text':
            // 텍스트 문제: 문제 텍스트, 정답 텍스트만
            if (sections.questionText) sections.questionText.style.display = 'block';
            if (sections.answerText) sections.answerText.style.display = 'block';
            break;
            
        case 'image':
            // 이미지 문제: 문제 텍스트 + 문제 이미지 + 정답 텍스트 + 정답 이미지
            if (sections.questionText) sections.questionText.style.display = 'block';
            if (sections.questionImage) sections.questionImage.style.display = 'block';
            if (sections.answerText) sections.answerText.style.display = 'block';
            if (sections.answerImage) sections.answerImage.style.display = 'block';

            break;
            
        case 'video':
            // 영상 문제: 문제 텍스트 + 유튜브 편집 + 정답 텍스트 + 정답 유튜브
            if (sections.questionText) sections.questionText.style.display = 'block';
            if (sections.youtube) sections.youtube.style.display = 'block';
            if (sections.answerText) sections.answerText.style.display = 'block';
            if (sections.answerYoutube) sections.answerYoutube.style.display = 'block';
            
            const youtubeTitle = document.getElementById('youtubeSectionTitle');
            if (youtubeTitle) youtubeTitle.textContent = '유튜브 영상 문제 편집';
            
            break;
            
        case 'audio':
            // 소리 문제: 영상 문제와 동일 (CSS로 숨김 처리는 게임 세션에서)
            if (sections.questionText) sections.questionText.style.display = 'block';
            if (sections.youtube) sections.youtube.style.display = 'block';
            if (sections.answerText) sections.answerText.style.display = 'block';
            if (sections.answerYoutube) sections.answerYoutube.style.display = 'block';
            
            const audioTitle = document.getElementById('youtubeSectionTitle');
            if (audioTitle) audioTitle.textContent = '유튜브 소리 문제 편집 (영상은 게임에서 가려짐)';
            
            break;
            
        default:
            if (IS_DEV_MODE) {
                console.warn('알 수 없는 문제 타입:', currentQuestionType);
            }
    }
    
    // 객관식 섹션은 타입과 관계없이 처리
    if (sections.incorrect) {
        sections.incorrect.style.display = isMultipleChoice ? 'block' : 'none';
    }
}

// 객관식 토글
export function toggleMultipleChoice() {
    const isChecked = document.getElementById('isMultipleChoice').checked;
    const incorrectSection = document.getElementById('incorrectSection');
    
    if (isChecked) {
        incorrectSection.classList.remove('hidden');
    } else {
        incorrectSection.classList.add('hidden');
    }
    
    // 문제 타입에 따라 추가 업데이트
    updateFormVisibility();
}

// 뷰 전환
export function switchView(view) {
    currentView = view;
    
    const overviewBtn = document.getElementById('overviewBtn');
    const editBtn = document.getElementById('editBtn');
    
    if (view === 'overview') {
        overviewBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 bg-blue-500 text-white';
        editBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 text-gray-300 hover:text-white';
        
        document.getElementById('overviewView').classList.remove('hidden');
        document.getElementById('editView').classList.add('hidden');
    } else {
        overviewBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 text-gray-300 hover:text-white';
        editBtn.className = 'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 bg-blue-500 text-white';
        
        document.getElementById('overviewView').classList.add('hidden');
        document.getElementById('editView').classList.remove('hidden');
        renderSidebar();
    }
}

// 이미지 미리보기
export async function previewImage(input, previewId) {
    const preview = document.getElementById(previewId);
    const img = preview.querySelector('img');

    if (input.files && input.files[0]) {
        const file = input.files[0];

        // 파일 크기 체크 (10MB)
        const maxSizeInBytes = 10 * 1024 * 1024;
        if (file.size > maxSizeInBytes) {
            alert('파일 크기가 너무 큽니다! (최대 10MB)');
            input.value = '';
            return;
        }

        try {
            // 파일 객체 저장 (나중에 Presigned URL로 업로드)
            if (previewId === 'questionImagePreview') {
                questionImageFile = file;
            } else if (previewId === 'answerImagePreview') {
                answerImageFile = file;
            }

            // 미리보기용 Blob 생성
            const blob = await resizeImageToBlob(file, 1024, 100);
            const blobUrl = URL.createObjectURL(blob);

            img.src = blobUrl;
            preview.classList.remove('hidden');

        } catch (error) {
            alert('이미지 처리 실패: ' + error.message);
            input.value = '';
        }
    }
}

// 이미지 제거
export function removeImage(inputId, previewId) {
    document.getElementById(inputId).value = '';
    const preview = document.getElementById(previewId);
    preview.classList.add('hidden');
    preview.querySelector('img').src = '';

    // File 객체 초기화
    if (previewId === 'questionImagePreview') {
        questionImageFile = null;
    } else if (previewId === 'answerImagePreview') {
        answerImageFile = null;
    }
}

// 드래그 앤 드롭 설정
function setupDragAndDrop() {
    // 전역: 브라우저 기본 드래그 앤 드롭 동작 막기 (새 창에서 열기 방지)
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    }, false);

    // 전역: 이미지 드롭 시 자동으로 이미지 타입으로 변경
    window.addEventListener('drop', async (e) => {
        e.preventDefault();

        // 드롭존 외부에서 드롭한 경우 체크
        const dropZone = e.target.closest('#questionImageDropZone, #answerImageDropZone');
        if (dropZone) {
            // 드롭존 내부면 기존 로직이 처리하므로 여기서는 무시
            return;
        }

        // 파일이 있는지 확인
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const file = files[0];

        // 이미지 파일인지 확인
        if (file.type.startsWith('image/')) {
            // 현재 타입이 이미지가 아니면 자동으로 변경
            if (currentQuestionType !== 'image') {
                selectQuestionType('image');

                // 약간의 지연 후 (DOM 업데이트 대기) 이미지를 문제 이미지로 설정
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // 문제 이미지 input에 파일 설정
            const questionImageInput = document.getElementById('questionImage');
            if (questionImageInput) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                questionImageInput.files = dataTransfer.files;

                await previewImage(questionImageInput, 'questionImagePreview');
            }
        }
    }, false);

    const dropZones = [
        { dropZoneId: 'questionImageDropZone', inputId: 'questionImage', previewId: 'questionImagePreview' },
        { dropZoneId: 'answerImageDropZone', inputId: 'answerImage', previewId: 'answerImagePreview' }
    ];

    dropZones.forEach(({ dropZoneId, inputId, previewId }) => {
        const dropZone = document.getElementById(dropZoneId);
        const input = document.getElementById(inputId);

        if (!dropZone || !input) return;

        // 클릭 시 파일 선택 창 열기
        dropZone.addEventListener('click', (e) => {
            e.stopPropagation();
            input.click();
        });

        // 드래그 오버 시
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('ring-2', 'ring-blue-500', 'bg-gray-800/50');
        });

        // 드래그 떠날 시
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('ring-2', 'ring-blue-500', 'bg-gray-800/50');
        });

        // 드롭 시
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('ring-2', 'ring-blue-500', 'bg-gray-800/50');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];

                // 이미지 파일 체크
                if (!file.type.startsWith('image/')) {
                    alert('이미지 파일만 업로드할 수 있습니다.');
                    return;
                }

                // 파일을 input에 설정하고 previewImage 호출
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                input.files = dataTransfer.files;

                await previewImage(input, previewId);
            }
        });
    });
}

// 유튜브 링크 붙여넣기 감지 설정
function setupPasteHandler() {
    // 전역 붙여넣기 이벤트 리스너
    document.addEventListener('paste', async (e) => {
        // input이나 textarea에 붙여넣기 하는 경우는 무시 (기본 동작 허용)
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            // 단, youtubeUrl이나 answerYoutubeUrl input인 경우는 처리
            if (target.id !== 'youtubeUrl' && target.id !== 'answerYoutubeUrl') {
                return;
            }
        }

        // 클립보드에서 텍스트 가져오기
        const pastedText = e.clipboardData?.getData('text');
        if (!pastedText) return;

        // 유튜브 링크인지 확인
        const videoId = extractYoutubeVideoId(pastedText);
        if (videoId) {
            // 현재 타입이 video나 audio가 아니면 자동으로 audio(소리)로 변경
            if (currentQuestionType !== 'video' && currentQuestionType !== 'audio') {
                e.preventDefault(); // 기본 붙여넣기 동작 막기

                selectQuestionType('audio');

                // 약간의 지연 후 (DOM 업데이트 대기) 유튜브 URL 설정
                await new Promise(resolve => setTimeout(resolve, 100));

                // 유튜브 URL input에 링크 설정
                const youtubeUrlInput = document.getElementById('youtubeUrl');
                if (youtubeUrlInput) {
                    youtubeUrlInput.value = pastedText;
                    updateYoutubePreview();
                }
            }
            // 이미 video나 audio 타입이면 기본 동작 허용
        }
    });
}

// 유튜브 미리보기 업데이트
export function updateYoutubePreview() {
    const url = document.getElementById('youtubeUrl').value.trim();
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;

    // 정답 유튜브 URL에도 자동 복사 (조건부)
    const answerYoutubeUrlInput = document.getElementById('answerYoutubeUrl');
    if (url && answerYoutubeUrlInput) {
        const currentAnswerUrl = answerYoutubeUrlInput.value.trim();
        const previousQuestionUrl = answerYoutubeUrlInput.dataset.previousQuestionUrl || '';

        // 정답 URL이 비어있거나, 이전 문제 URL과 같으면 자동 복사
        // (사용자가 의도적으로 다른 URL로 변경한 경우는 덮어쓰지 않음)
        if (!currentAnswerUrl || currentAnswerUrl === previousQuestionUrl) {
            answerYoutubeUrlInput.value = url;
            updateAnswerYoutubePreview(); // 정답 미리보기도 업데이트
        }

        // 현재 문제 URL을 저장 (다음 비교를 위해)
        answerYoutubeUrlInput.dataset.previousQuestionUrl = url;
    }

    if (!url) {
        // iframe src를 비워서 백그라운드 재생 중단
        document.getElementById('youtubeIframe').src = '';
        document.getElementById('youtubePreview').classList.add('hidden');
        return;
    }

    const videoId = extractYoutubeVideoId(url);
    if (videoId) {
        const iframe = document.getElementById('youtubeIframe');
        let embedUrl = `https://www.youtube.com/embed/${videoId}?`;

        if (startTime) {
            const startSeconds = parseTimeToSeconds(startTime);
            embedUrl += `start=${startSeconds}&`;
        } else {
            // 시작 시간이 없으면 0초부터
            embedUrl += `start=0&`;
        }

        if (endTime) {
            const endSeconds = parseTimeToSeconds(endTime);
            embedUrl += `end=${endSeconds}&`;
        }

        iframe.src = embedUrl;
        document.getElementById('youtubePreview').classList.remove('hidden');
    }
}

// 정답 유튜브 미리보기 업데이트
export function updateAnswerYoutubePreview() {
    const url = document.getElementById('answerYoutubeUrl').value.trim();
    const startTime = document.getElementById('answerStartTime').value;
    
    if (!url) {
        // iframe src를 비워서 백그라운드 재생 중단
        document.getElementById('answerYoutubeIframe').src = '';
        document.getElementById('answerYoutubePreview').classList.add('hidden');
        return;
    }
    
    const videoId = extractYoutubeVideoId(url);
    if (videoId) {
        const iframe = document.getElementById('answerYoutubeIframe');
        let embedUrl = `https://www.youtube.com/embed/${videoId}?`;
        
        if (startTime) {
            const startSeconds = parseTimeToSeconds(startTime);
            embedUrl += `start=${startSeconds}&`;
        }
        
        iframe.src = embedUrl;
        document.getElementById('answerYoutubePreview').classList.remove('hidden');
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

// 시간을 초로 변환
function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 1) return parts[0]; // 초만
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // 분:초
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // 시:분:초
    
    return 0;
}

// 초를 시간 형식으로 변환
function secondsToTimeFormat(seconds) {
    if (!seconds || seconds === 0) return '';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else if (minutes > 0) {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${secs}`;
    }
}

// 토스트 알림 표시
function showToast(message, type = 'success') {
    const container = document.getElementById('saveToastContainer');
    if (!container) return;

    // 기존 토스트 제거
    container.innerHTML = '';

    // 타입별 색상 설정
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500'
    };
    const bgColor = colors[type] || colors.success;

    // 새 토스트 생성 (absolute positioning으로 레이아웃에 영향 없음)
    const toast = document.createElement('div');
    toast.className = `absolute bottom-0 left-0 right-0 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg text-center transition-opacity duration-300 z-10`;
    toast.textContent = message;
    container.appendChild(toast);

    // 2초 후 제거
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            container.innerHTML = '';
        }, 300);
    }, 2000);
}

// 정답 추가
export function addAnswer() {
    const input = document.getElementById('answerInput');
    const answer = input.value.trim();
    
    if (!answer) {
        alert('정답을 입력하세요.');
        return;
    }

    if (currentAnswers.length >= 20) {
        alert('정답은 최대 20개까지 추가할 수 있습니다.');
        return;
    }
    
    if (currentAnswers.includes(answer)) {
        alert('이미 추가된 정답입니다.');
        return;
    }
    
    currentAnswers.push(answer);
    input.value = '';
    renderAnswers();
    triggerAutoSave(); // 자동 저장 트리거
}

// 정답 렌더링
function renderAnswers() {
    const container = document.getElementById('answersList');
    container.innerHTML = '';
    
    currentAnswers.forEach((answer, index) => {
        const tag = document.createElement('div');
        tag.className = 'bg-green-500/20 border border-green-500 text-green-300 px-4 py-2 rounded-lg flex items-center space-x-2';
        tag.innerHTML = `
            <span>${answer}</span>
            <button onclick="window.removeAnswer(${index})" class="text-green-300 hover:text-green-100">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        `;
        container.appendChild(tag);
    });
}

// 정답 제거
export function removeAnswer(index) {
    currentAnswers.splice(index, 1);
    renderAnswers();
    triggerAutoSave(); // 자동 저장 트리거
}

// 오답 추가
export function addIncorrect() {
    const input = document.getElementById('incorrectInput');
    const incorrect = input.value.trim();
    
    if (!incorrect) {
        alert('오답을 입력하세요.');
        return;
    }
    
    if (currentIncorrects.includes(incorrect)) {
        alert('이미 추가된 오답입니다.');
        return;
    }
    
    if (currentIncorrects.length >= 4) {
        alert('오답은 최대 4개까지만 추가할 수 있습니다.');
        return;
    }
    
    currentIncorrects.push(incorrect);
    input.value = '';
    renderIncorrects();
    triggerAutoSave(); // 자동 저장 트리거
}

// 오답 렌더링
function renderIncorrects() {
    const container = document.getElementById('incorrectList');
    container.innerHTML = '';
    
    currentIncorrects.forEach((incorrect, index) => {
        const tag = document.createElement('div');
        tag.className = 'bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded-lg flex items-center space-x-2';
        tag.innerHTML = `
            <span>${incorrect}</span>
            <button onclick="window.removeIncorrect(${index})" class="text-red-300 hover:text-red-100">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        `;
        container.appendChild(tag);
    });
}

// 오답 제거
export function removeIncorrect(index) {
    currentIncorrects.splice(index, 1);
    renderIncorrects();
    triggerAutoSave(); // 자동 저장 트리거
}

// 문제 카드 렌더링
function renderQuestions() {
    const container = document.getElementById('questionsList'); // ⭐ HTML과 일치
    const emptyState = document.getElementById('emptyState');

    if (!container) {
        console.error('questionsList 요소를 찾을 수 없습니다');
        return;
    }
    
    if (questions.length === 0) {
        container.innerHTML = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
        }
        return;
    }
    
    if (emptyState) {
        emptyState.classList.add('hidden');
    }
    container.innerHTML = '';
    
    questions.forEach((q, index) => {
        const questionType = detectQuestionType(q);
        
        // 타입별 한글명
        const typeNames = {
            'text': '텍스트',
            'image': '이미지', 
            'video': '영상',
            'audio': '소리'
        };
        const typeName = typeNames[questionType] || '텍스트';
        
        const card = document.createElement('div');
        card.className = 'bg-gray-800/50 rounded-2xl overflow-hidden border border-gray-700 hover:border-blue-500 transition-all duration-200 cursor-pointer transform hover:scale-105';
        
        // ⭐ 카드 클릭 이벤트 추가
        card.onclick = () => editQuestion(index);
        
        let previewContent = '';
        
        // 미리보기 콘텐츠 생성
        if (questionType === 'image' && q.imageBase64) {
            previewContent = `
                <div class="w-full h-48 bg-gray-900 overflow-hidden">
                    <img src="${q.imageBase64}" alt="문제 이미지" class="w-full h-full object-cover">
                </div>
            `;
        } else if ((questionType === 'video' || questionType === 'audio') && q.youtubeUrl) {
            const videoId = extractYoutubeVideoId(q.youtubeUrl);
            if (videoId) {
                previewContent = `
                    <div class="relative w-full h-48 bg-gray-900">
                        <img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg" 
                             alt="유튜브 썸네일" 
                             class="w-full h-full object-cover">
                        ${questionType === 'audio' ? '<div class="absolute top-2 right-2 bg-purple-500 text-white text-xs px-2 py-1 rounded">소리만</div>' : ''}
                    </div>
                `;
            } else {
                previewContent = `
                    <div class="w-full h-48 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center p-6">
                        <p class="text-white text-center text-lg font-medium line-clamp-4">${q.text || '텍스트 없음'}</p>
                    </div>
                `;
            }
        } else {
            const previewText = q.text || '텍스트 없음';
            previewContent = `
                <div class="w-full h-48 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center p-6">
                    <p class="text-white text-center text-lg font-medium line-clamp-4">${previewText}</p>
                </div>
            `;
        }
        
        card.innerHTML = `
            ${previewContent}
            <div class="p-6">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center space-x-2">
                        <span class="text-sm font-medium text-blue-400">문제 ${index + 1}</span>
                        <span class="text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-300">${typeName}</span>
                    </div>
                </div>
                <h3 class="text-white font-medium mb-2 line-clamp-2">${q.text || '텍스트 없음'}</h3>
                <div class="flex items-center justify-between text-sm text-gray-400">
                    <span>${q.timeLimit || 30}초</span>
                    <span>${q.answers?.length || 0}개 정답</span>
                </div>
                ${q.isChoice ? '<div class="mt-2 text-xs text-purple-400">객관식</div>' : ''}
            </div>
        `;
        
        container.appendChild(card);
    });
    
    updateQuestionCount();
}

// 사이드바 렌더링
function renderSidebar() {
    const sidebar = document.getElementById('questionSidebar');
    sidebar.innerHTML = '';
    
    if (questions.length === 0) {
        sidebar.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">문제가 없습니다</p>';
        return;
    }
    
    questions.forEach((q, index) => {
        // 문제 타입 자동 감지
        const questionType = detectQuestionType(q);
        
        const item = document.createElement('div');
        const isActive = index === currentEditingIndex;
        item.className = `rounded-lg cursor-pointer transition-all duration-200 overflow-hidden ${
            isActive 
            ? 'ring-2 ring-blue-500' 
            : 'hover:ring-2 hover:ring-gray-600'
        }`;
        item.onclick = () => editQuestion(index);
        
        // 문제 타입 이모지
        let typeName = '텍스트';
        if (questionType === 'image') {
            typeName = '이미지';
        } else if (questionType === 'video') {
            typeName = '영상';
        } else if (questionType === 'audio') {
            typeName = '소리';
        }
        
        // 미리보기 썸네일 생성 (높이를 120px로 증가)
        let thumbnailContent = '';
        
        if (questionType === 'image' && q.imageBase64) {
            // 이미지 문제
            thumbnailContent = `
                <div class="w-full h-[158px] bg-gray-900 overflow-hidden">
                    <img src="${q.imageBase64}" alt="미리보기" class="w-full h-full object-cover">
                </div>
            `;
        } else if ((questionType === 'video' || questionType === 'audio') && q.youtubeUrl) {
            // 영상/소리 문제
            const videoId = extractYoutubeVideoId(q.youtubeUrl);
            if (videoId) {
                const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                thumbnailContent = `
                    <div class="w-full h-[158px] bg-gray-900 overflow-hidden relative">
                        <img src="${thumbnailUrl}" alt="미리보기" class="w-full h-full object-cover">
                        <div class="absolute inset-0 flex items-center justify-center bg-black/40">
                            <svg class="w-8 h-8 text-white opacity-90" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </div>
                        ${questionType === 'audio' ? '<div class="absolute top-1 right-1 bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded">🔊</div>' : ''}
                    </div>
                `;
            } else {
                // 비디오 ID 추출 실패 시
                thumbnailContent = `
                    <div class="w-full h-[158px] bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center px-2">
                        <p class="text-white text-xs text-center line-clamp-3">${q.text || '텍스트 없음'}</p>
                    </div>
                `;
            }
        } else {
            // 텍스트 문제
            thumbnailContent = `
                <div class="w-full h-[158px] bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center px-2">
                    <p class="text-white text-xs text-center line-clamp-3">${q.text || '텍스트 없음'}</p>
                </div>
            `;
        }
        
        item.innerHTML = `
            ${thumbnailContent}
            <div class="p-2 ${isActive ? 'bg-blue-500' : 'bg-gray-700/50'}">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-medium ${isActive ? 'text-blue-100' : 'text-gray-400'}">문제 ${index + 1}</span>
                </div>
                <p class="text-xs font-medium truncate ${isActive ? 'text-white' : 'text-gray-300'}">${q.text || '텍스트 없음'}</p>
                <p class="text-xs ${isActive ? 'text-blue-100' : 'text-gray-500'} mt-1">${q.timeLimit || 30}초 • ${q.answers?.length || 0}개 정답</p>
            </div>
        `;
        
        sidebar.appendChild(item);
    });
}

// 문제 수 업데이트
function updateQuestionCount() {
    document.getElementById('questionCount').textContent = `${questions.length}개 문제( 최대 50문제 )`;
}

// 새 문제 만들기
export async function createNewQuestion() {
    if (questions.length >= 50) {
        alert('퀴즈에는 최대 50개의 문제만 추가할 수 있습니다.');
        return;
    }

    // 현재 편집 중인 문제가 있으면 먼저 저장
    if (currentEditingIndex !== null) {
        // 정답이 있으면 저장
        if (currentAnswers.length > 0) {
            updateAutoSaveStatus('saving');

            // 현재 폼 필드 값을 먼저 캡처
            const currentFormData = {
                text: document.getElementById('questionText').value.trim(),
                timeLimit: parseInt(document.getElementById('timeLimit').value),
                youtubeUrl: document.getElementById('youtubeUrl')?.value?.trim(),
                startTime: document.getElementById('startTime')?.value,
                endTime: document.getElementById('endTime')?.value,
                answerYoutubeUrl: document.getElementById('answerYoutubeUrl')?.value,
                answerStartTime: document.getElementById('answerStartTime')?.value,
                hint: document.getElementById('hintInput')?.value?.trim() || null,
                hintShowTime: parseInt(document.getElementById('hintShowTime')?.value) || 10,
                isChoice: document.getElementById('isMultipleChoice')?.checked,
                questionType: currentQuestionType,
                answers: [...currentAnswers],
                incorrectAnswers: [...currentIncorrects],
                imageFile: questionImageFile,
                answerImageFile: answerImageFile
            };

            try {
                await saveQuestion(currentFormData);
                updateAutoSaveStatus('saved');
            } catch (error) {
                updateAutoSaveStatus('error');
                console.error('새 문제 생성 시 저장 실패:', error);
                showToast('현재 문제 저장에 실패했습니다!', 'error');
                return;
            }
        } else {
            // 정답이 없으면 경고
            showToast('현재 문제에 정답을 추가해야 합니다!', 'error');
            return;
        }
    }

    const newQuestion = {
        questionType: 'text', // 기본값: 텍스트 문제
        text: '',
        timeLimit: '', // 빈 값으로 시작 (editQuestion에서 채움)
        youtubeUrl: '',
        youtubeStartTime: 0,
        youtubeEndTime: 0,
        answerYoutubeUrl: '',
        answerYoutubeStartTime: 0,
        imageBase64: '',
        answerImageBase64: '',
        answers: [],
        incorrectAnswers: [],
        isChoice: false,
        hint: null, // 힌트 (선택)
        hintShowTime: '' // 빈 값으로 시작 (editQuestion에서 채움)
    };

    questions.push(newQuestion);

    if (currentView === 'overview') {
        switchView('edit');
    }

    await editQuestion(questions.length - 1);
    renderQuestions();
}

// 문제 편집 함수 (기존 문제 불러올 때)
export async function editQuestion(index) {
    // 다른 문제로 전환하는 경우, 현재 문제를 먼저 저장
    if (currentEditingIndex !== null && currentEditingIndex !== index) {
        // 정답이 있으면 저장 (유효성 검사)
        if (currentAnswers.length > 0) {
            updateAutoSaveStatus('saving');

            // 현재 폼 필드 값을 먼저 저장 (전역 변수에 임시 보관)
            const currentFormData = {
                text: document.getElementById('questionText').value.trim(),
                timeLimit: parseInt(document.getElementById('timeLimit').value),
                youtubeUrl: document.getElementById('youtubeUrl')?.value?.trim(),
                startTime: document.getElementById('startTime')?.value,
                endTime: document.getElementById('endTime')?.value,
                answerYoutubeUrl: document.getElementById('answerYoutubeUrl')?.value,
                answerStartTime: document.getElementById('answerStartTime')?.value,
                hint: document.getElementById('hintInput')?.value?.trim() || null,
                hintShowTime: parseInt(document.getElementById('hintShowTime')?.value) || 10,
                isChoice: document.getElementById('isMultipleChoice')?.checked,
                questionType: currentQuestionType,
                answers: [...currentAnswers],
                incorrectAnswers: [...currentIncorrects],
                imageFile: questionImageFile,
                answerImageFile: answerImageFile
            };

            try {
                await saveQuestion(currentFormData);
                updateAutoSaveStatus('saved');
            } catch (error) {
                updateAutoSaveStatus('error');
                console.error('문제 전환 시 저장 실패:', error);
                // 저장 실패해도 계속 진행 (사용자가 수동 저장할 수 있도록)
            }
        }
    }

    // 전체보기 뷰에서 클릭 시 편집 뷰로 전환
    if (currentView === 'overview') {
        switchView('edit');
    }

    currentEditingIndex = index;
    const question = questions[index];
    
    // 문제 타입 설정 (없으면 자동 감지)
    const questionType = question.questionType || detectQuestionType(question);
    
    // 자동 감지한 타입을 문제 객체에 저장
    if (!question.questionType) {
        question.questionType = questionType;
    }
    
    selectQuestionType(questionType);
    
    // 폼 데이터 채우기
    document.getElementById('questionText').value = question.text || '';

    // 🔄 제한시간: 빈 값이면 이전 문제 값 또는 30초 기본값
    let timeLimitValue;
    if (question.timeLimit === '' || question.timeLimit === undefined || question.timeLimit === null) {
        // 새 문제인 경우: 이전 문제의 제한시간 가져오기
        if (currentEditingIndex > 0 && questions[currentEditingIndex - 1]) {
            timeLimitValue = questions[currentEditingIndex - 1].timeLimit || 30;
        } else {
            timeLimitValue = 30; // 첫 문제는 30초 기본값
        }
    } else {
        timeLimitValue = question.timeLimit; // 기존 값 사용
    }
    document.getElementById('timeLimit').value = timeLimitValue;

    document.getElementById('isMultipleChoice').checked = question.isChoice || false;
    
    // 이미지 데이터 로드 (기존 이미지는 URL, 새 이미지는 File 객체)
    questionImageFile = null; // 새 이미지가 아니므로 null
    const existingQuestionImage = question.imageBase64 || '';
    if (existingQuestionImage) {
        document.getElementById('questionImagePreview').querySelector('img').src = existingQuestionImage;
        document.getElementById('questionImagePreview').classList.remove('hidden');
    } else {
        document.getElementById('questionImagePreview').classList.add('hidden');
    }

    answerImageFile = null; // 새 이미지가 아니므로 null
    const existingAnswerImage = question.answerImageBase64 || '';
    if (existingAnswerImage) {
        document.getElementById('answerImagePreview').querySelector('img').src = existingAnswerImage;
        document.getElementById('answerImagePreview').classList.remove('hidden');
    } else {
        document.getElementById('answerImagePreview').classList.add('hidden');
    }

    // 유튜브 설정 로드
    document.getElementById('youtubeUrl').value = question.youtubeUrl || '';
    document.getElementById('startTime').value = secondsToTimeFormat(question.youtubeStartTime || 0);
    document.getElementById('endTime').value = secondsToTimeFormat(question.youtubeEndTime || 0);

    const answerUrlInput = document.getElementById('answerYoutubeUrl');
    answerUrlInput.value = question.answerYoutubeUrl || '';
    // previousQuestionUrl 초기화 (문제 로드 시)
    answerUrlInput.dataset.previousQuestionUrl = question.youtubeUrl || '';

    document.getElementById('answerStartTime').value = secondsToTimeFormat(question.answerYoutubeStartTime || 0);
    
    // 정답/오답
    currentAnswers = [...(question.answers || [])];
    currentIncorrects = [...(question.incorrectAnswers || [])];

    renderAnswers();
    renderIncorrects();

    // 힌트 데이터 로드
    document.getElementById('hintInput').value = question.hint || '';

    // 🔄 힌트 공개 시간: 빈 값이면 이전 문제 값 또는 10초 기본값
    let hintShowTimeValue;
    if (question.hintShowTime === '' || question.hintShowTime === undefined || question.hintShowTime === null) {
        // 새 문제인 경우: 이전 문제의 힌트 공개 시간 가져오기
        if (currentEditingIndex > 0 && questions[currentEditingIndex - 1]) {
            hintShowTimeValue = questions[currentEditingIndex - 1].hintShowTime || 10;
        } else {
            hintShowTimeValue = 10; // 첫 문제는 10초 기본값
        }
    } else {
        hintShowTimeValue = question.hintShowTime; // 기존 값 사용
    }
    document.getElementById('hintShowTime').value = hintShowTimeValue;

    // 객관식 토글
    toggleMultipleChoice();
    
    // 유튜브 미리보기 업데이트 (URL이 없어도 호출해서 iframe 정리)
    updateYoutubePreview();
    updateAnswerYoutubePreview();

    // 사이드바 업데이트
    renderSidebar();

    // 자동 저장 이벤트 리스너 설정 (기존 리스너 제거 후 재설정)
    setupAutoSaveListeners();
}

// 자동 저장 이벤트 리스너 설정
function setupAutoSaveListeners() {
    const fields = [
        'questionText',
        'timeLimit',
        'hintInput',
        'hintShowTime',
        'youtubeUrl',
        'startTime',
        'endTime',
        'answerYoutubeUrl',
        'answerStartTime'
    ];

    fields.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element && !element.dataset.autoSaveListener) {
            element.addEventListener('input', triggerAutoSave);
            element.dataset.autoSaveListener = 'true';
        }
    });

    // 객관식 체크박스도 자동 저장
    const multipleChoiceCheckbox = document.getElementById('isMultipleChoice');
    if (multipleChoiceCheckbox && !multipleChoiceCheckbox.dataset.autoSaveListener) {
        multipleChoiceCheckbox.addEventListener('change', triggerAutoSave);
        multipleChoiceCheckbox.dataset.autoSaveListener = 'true';
    }
}

// 자동 저장 상태 표시
function updateAutoSaveStatus(status) {
    const statusElement = document.getElementById('autoSaveStatus');
    if (!statusElement) return;

    switch(status) {
        case 'saving':
            statusElement.textContent = '저장 중...';
            statusElement.className = 'text-sm text-blue-400';
            break;
        case 'saved':
            statusElement.textContent = '자동 저장됨';
            statusElement.className = 'text-sm text-green-400';
            // 3초 후 메시지 제거
            setTimeout(() => {
                if (statusElement.textContent === '자동 저장됨') {
                    statusElement.textContent = '';
                }
            }, 3000);
            break;
        case 'error':
            statusElement.textContent = '저장 실패';
            statusElement.className = 'text-sm text-red-400';
            break;
        default:
            statusElement.textContent = '';
    }
}

// 자동 저장 함수
async function autoSaveQuestion() {
    if (currentEditingIndex === null) return;
    if (isSaving || isSavingAuto) return;

    // 정답이 없으면 자동 저장하지 않음 (최소 유효성 검사)
    if (currentAnswers.length === 0) {
        return;
    }

    isSavingAuto = true;
    updateAutoSaveStatus('saving');

    try {
        await saveQuestion();
        updateAutoSaveStatus('saved');
    } catch (error) {
        console.error('자동 저장 실패:', error);
        updateAutoSaveStatus('error');
    } finally {
        isSavingAuto = false;
    }
}

// Debounce: 입력이 멈춘 후 30초 뒤에 백업용 자동 저장
function triggerAutoSave() {
    // 기존 타이머 취소
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }

    // 30초 후 자동 저장 (백업용)
    autoSaveTimeout = setTimeout(() => {
        autoSaveQuestion();
    }, 30000);
}

// 저장 중 플래그
let isSaving = false;

export async function saveQuestion(preCapturedData = null) {
    if (currentEditingIndex === null) return;

    // 이미 저장 중이면 무시
    if (isSaving) {
        return;
    }

    // 사전에 캡처된 데이터가 있으면 사용, 없으면 DOM에서 읽기
    const text = preCapturedData ? preCapturedData.text : document.getElementById('questionText').value.trim();
    const timeLimit = preCapturedData ? preCapturedData.timeLimit : parseInt(document.getElementById('timeLimit').value);
    const isChoice = preCapturedData ? preCapturedData.isChoice : document.getElementById('isMultipleChoice').checked;
    const youtubeUrl = preCapturedData ? preCapturedData.youtubeUrl : document.getElementById('youtubeUrl')?.value?.trim();

    // 답안 및 오답 데이터
    const answers = preCapturedData ? preCapturedData.answers : currentAnswers;
    const incorrectAnswers = preCapturedData ? preCapturedData.incorrectAnswers : currentIncorrects;

    // 이미지 파일
    const questionImg = preCapturedData ? preCapturedData.imageFile : questionImageFile;
    const answerImg = preCapturedData ? preCapturedData.answerImageFile : answerImageFile;

    // 유효성 검사 - 문제 텍스트, 이미지, 유튜브 중 하나는 있어야 함
    const existingQuestion = questions[currentEditingIndex];
    const hasExistingImage = existingQuestion?.imageBase64; // 기존 저장된 이미지 확인

    if (!text && !questionImg && !hasExistingImage && !youtubeUrl) {
        showToast('문제 텍스트, 이미지, 또는 유튜브 링크 중 하나는 입력해야 합니다.', 'error');
        return;
    }

    if (isNaN(timeLimit) || timeLimit < 10 || timeLimit > 300) {
        showToast('제한 시간은 10초에서 300초 사이여야 합니다.', 'error');
        return;
    }

    // 사전 캡처된 데이터가 없을 때만 입력란 자동 추가 로직 실행
    if (!preCapturedData) {
        // 🔄 정답 입력란에 값이 있으면 자동으로 추가
        const answerInput = document.getElementById('answerInput');
        const answerInputValue = answerInput?.value?.trim();

        if (currentAnswers.length === 0) {
            // 정답이 없는데 입력란에 값이 있으면 자동 추가
            if (answerInputValue) {
                currentAnswers.push(answerInputValue);
                answerInput.value = ''; // 입력란 초기화
                renderAnswers(); // 화면 업데이트
            } else {
                showToast('최소 1개 이상의 정답을 추가하세요.', 'error');
                return;
            }
        }

        // 🔄 객관식: 오답 입력란에 값이 있으면 자동으로 추가
        if (isChoice) {
            const incorrectInput = document.getElementById('incorrectInput');
            const incorrectInputValue = incorrectInput?.value?.trim();

            if (currentIncorrects.length === 0) {
                // 오답이 없는데 입력란에 값이 있으면 자동 추가
                if (incorrectInputValue) {
                    currentIncorrects.push(incorrectInputValue);
                    incorrectInput.value = ''; // 입력란 초기화
                    renderIncorrects(); // 화면 업데이트
                } else {
                    showToast('객관식 문제는 최소 1개 이상의 오답이 필요합니다.', 'error');
                    return;
                }
            }
        }
    } else {
        // 사전 캡처된 데이터 사용 시 유효성 검사
        if (answers.length === 0) {
            showToast('최소 1개 이상의 정답을 추가하세요.', 'error');
            return;
        }

        if (isChoice && incorrectAnswers.length === 0) {
            showToast('객관식 문제는 최소 1개 이상의 오답이 필요합니다.', 'error');
            return;
        }
    }

    // 힌트 데이터 가져오기
    const hint = preCapturedData ? preCapturedData.hint : (document.getElementById('hintInput')?.value?.trim() || null);
    const hintShowTime = preCapturedData ? preCapturedData.hintShowTime : (document.getElementById('hintShowTime') ? parseInt(document.getElementById('hintShowTime').value) : 10);

    // 문제 타입 결정
    const questionType = preCapturedData ? preCapturedData.questionType : currentQuestionType;

    // 기본 문제 데이터
    let finalQuestionData = {
        questionType: questionType,
        text: text,
        timeLimit: timeLimit,
        answers: [...answers],
        incorrectAnswers: isChoice ? [...incorrectAnswers] : [],
        isChoice: isChoice,
        imageBase64: null,
        answerImageBase64: null,
        youtubeUrl: null,
        youtubeStartTime: null,
        youtubeEndTime: null,
        answerYoutubeUrl: null,
        answerYoutubeStartTime: null,
        answerYoutubeEndTime: null,
        hint: hint, // 힌트 (선택)
        hintShowTime: hintShowTime // 힌트 표시 시간
    };

    // 타입별 데이터 추가 (사용하지 않는 필드는 명시적으로 null 유지)
    if (questionType === 'text') {
        // 텍스트 문제: 이미지와 유튜브 데이터는 null
        // imageBase64, answerImageBase64, youtubeUrl 등은 이미 null로 초기화됨

    } else if (questionType === 'image') {
        // 이미지 문제: 유튜브 데이터는 null
        const existingQuestion = questions[currentEditingIndex];

        // 새 이미지를 업로드했거나 기존 이미지가 있어야 함
        if (!questionImg && !existingQuestion?.imageBase64) {
            showToast('문제 이미지를 업로드하세요.', 'error');
            return;
        }

        // Presigned URL로 이미지 업로드 (새 이미지가 있을 때만)
        try {
            if (questionImg) {
                showToast('문제 이미지 업로드 중...', 'info');
                const questionImageUrl = await uploadToS3WithPresignedUrl(
                    questionImg,
                    `questions/${quizId}`,
                    `q${currentEditingIndex}_${Date.now()}`
                );
                finalQuestionData.imageBase64 = questionImageUrl;
            } else {
                // 기존 이미지 유지
                finalQuestionData.imageBase64 = existingQuestion.imageBase64;
            }

            // 정답 이미지도 처리
            if (answerImg) {
                showToast('정답 이미지 업로드 중...', 'info');
                const answerImageUrl = await uploadToS3WithPresignedUrl(
                    answerImg,
                    `answers/${quizId}`,
                    `a${currentEditingIndex}_${Date.now()}`
                );
                finalQuestionData.answerImageBase64 = answerImageUrl;
            } else if (existingQuestion?.answerImageBase64) {
                // 기존 정답 이미지 유지
                finalQuestionData.answerImageBase64 = existingQuestion.answerImageBase64;
            } else {
                finalQuestionData.answerImageBase64 = null;
            }
        } catch (error) {
            showToast('이미지 업로드 실패: ' + error.message, 'error');
            return;
        }
        // youtubeUrl 관련 필드는 이미 null로 초기화됨

    } else if (questionType === 'video' || questionType === 'audio') {
        // 영상/소리 문제: 이미지 데이터는 명시적으로 null 설정
        if (!youtubeUrl) {
            showToast('유튜브 URL을 입력하세요.', 'error');
            return;
        }

        // 유튜브 데이터 설정 (사전 캡처된 데이터가 있으면 사용, 없으면 DOM에서 읽기)
        finalQuestionData.youtubeUrl = youtubeUrl;
        finalQuestionData.youtubeStartTime = preCapturedData ?
            parseTimeToSeconds(preCapturedData.startTime) || 0 :
            parseTimeToSeconds(document.getElementById('startTime').value) || 0;
        finalQuestionData.youtubeEndTime = preCapturedData ?
            parseTimeToSeconds(preCapturedData.endTime) || 0 :
            parseTimeToSeconds(document.getElementById('endTime').value) || 0;

        const answerYoutubeUrl = preCapturedData ?
            preCapturedData.answerYoutubeUrl :
            document.getElementById('answerYoutubeUrl').value.trim();
        if (answerYoutubeUrl) {
            finalQuestionData.answerYoutubeUrl = answerYoutubeUrl;
            finalQuestionData.answerYoutubeStartTime = preCapturedData ?
                parseTimeToSeconds(preCapturedData.answerStartTime) || 0 :
                parseTimeToSeconds(document.getElementById('answerStartTime').value) || 0;
        }

        // 이미지 데이터는 명시적으로 null (이전 이미지 삭제)
        finalQuestionData.imageBase64 = null;
        finalQuestionData.answerImageBase64 = null;
    }

    // 문제 데이터 업데이트
    questions[currentEditingIndex] = finalQuestionData;

    isSaving = true;

    try {
        await saveCurrentQuestion();  // ✅ 개별 문제만 저장
        showToast('저장되었습니다!', 'success');
        renderQuestions();
        renderSidebar();
    } catch (error) {
        console.error('문제 저장 실패:', error);
        showToast('저장 중 오류가 발생했습니다', 'error');
    } finally {
        isSaving = false;
    }
}

// 개별 문제 저장 (수정 시 사용) - 재시도 로직 포함
async function saveCurrentQuestion(retryCount = 0) {
    const MAX_RETRIES = 2;

    if (currentEditingIndex === null) {
        throw new Error('저장할 문제가 선택되지 않았습니다.');
    }

    const questionData = questions[currentEditingIndex];

    try {
        const response = await fetchWithAuth(
            `/api/quiz/${quizId}/question/${currentEditingIndex}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(questionData)
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));

            // 500번대 서버 오류이고 재시도 가능하면 재시도
            if (response.status >= 500 && retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000));
                return saveCurrentQuestion(retryCount + 1);
            }

            throw new Error(errorData.message || `서버 저장 실패 (${response.status})`);
        }

        const result = await response.json();
        return result;

    } catch (error) {
        // 네트워크 오류 (TypeError: Failed to fetch 등)
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            if (retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000));
                return saveCurrentQuestion(retryCount + 1);
            }

            throw new Error('네트워크 연결에 실패했습니다. 인터넷 연결을 확인해주세요.');
        }

        throw error;
    }
}

// 전체 문제 목록 저장 (삭제 시 사용)
async function saveAllQuestions() {
    const response = await fetchWithAuth(
        `/api/quiz/${quizId}/questions`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions })
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '서버 저장 실패');
    }

    const result = await response.json();
    return result;
}

// 현재 문제 삭제
export async function deleteCurrentQuestion() {
    if (currentEditingIndex === null) return;

    // 공개 상태인 퀴즈에서 10문제 이하로 줄일 수 없음
    if (currentQuiz?.isComplete && questions.length <= 10) {
        alert('공개 상태에서는 10문제 이하로 문제 수를 줄일 수 없습니다.');
        return;
    }

    if (!confirm('이 문제를 삭제하시겠습니까?')) return;

    questions.splice(currentEditingIndex, 1);
    
    try {
        await saveAllQuestions();
        alert('삭제되었습니다!');
        
        // UI 초기화
        currentEditingIndex = null;
        currentAnswers = [];
        currentIncorrects = [];
        questionImageFile = null;
        answerImageFile = null;
        
        renderQuestions();
        renderSidebar();
        
        // 편집 뷰가 열려있다면 첫 번째 문제로 이동하거나 전체보기로 전환
        if (questions.length > 0) {
            editQuestion(0);
        } else {
            switchView('overview');
        }
    } catch (error) {
        alert('삭제 중 오류가 발생했습니다: ' + error.message);
    }
}

// 서버에서 문제 목록 로드
async function loadQuestions() {
    try {
        const response = await fetch(`/api/quiz/${quizId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('퀴즈를 불러올 수 없습니다');
        }

        const quiz = await response.json();
        currentQuiz = quiz; // 퀴즈 정보 저장
        document.getElementById('quizTitle').textContent = quiz.title || '퀴즈 편집';
        questions = quiz.questions || [];

        document.getElementById('isRandomOrder').checked = quiz.isRandomOrder || false;

        // 기존 문제들의 타입을 자동으로 감지하여 업데이트
        questions.forEach(q => {
            if (!q.questionType) {
                q.questionType = detectQuestionType(q);
            }
        });

        renderQuestions();
        updateQuestionCount();
    } catch (error) {
        alert('퀴즈를 불러오는 중 오류가 발생했습니다: ' + error.message);
    }
}

export function formatTimeOnBlur(inputId) {
    const input = document.getElementById(inputId);
    if (!input || !input.value.trim()) return;
    
    // 숫자만 추출
    let numbers = input.value.replace(/\D/g, '');
    if (!numbers) {
        input.value = '';
        return;
    }
    
    // 최대 6자리까지만 (hhmmss)
    numbers = numbers.slice(0, 6);
    const len = numbers.length;
    
    let formatted = '';
    
    if (len <= 2) {
        // 1~2자리: 초만 (예: 5 → 5, 45 → 45)
        formatted = numbers;
    } else if (len <= 4) {
        // 3~4자리: 분:초 (예: 120 → 1:20, 152 → 1:52, 1234 → 12:34)
        const minutes = parseInt(numbers.slice(0, len - 2));
        const seconds = numbers.slice(len - 2);
        formatted = `${minutes}:${seconds}`;
    } else {
        // 5~6자리: 시:분:초 (예: 12011 → 01:20:11, 123456 → 12:34:56)
        const hours = numbers.slice(0, len - 4).padStart(2, '0');
        const minutes = numbers.slice(len - 4, len - 2);
        const seconds = numbers.slice(len - 2);
        formatted = `${hours}:${minutes}:${seconds}`;
    }
    
    input.value = formatted;
    
    // 미리보기 업데이트
    if (inputId === 'startTime' || inputId === 'endTime') {
        updateYoutubePreview();
    } else if (inputId === 'answerStartTime' || inputId === 'answerEndTime') {
        updateAnswerYoutubePreview();
    }
}

export async function saveRandomOrderSetting() {
    const isRandomOrder = document.getElementById('isRandomOrder').checked;
    const feedbackEl = document.getElementById('randomOrderSaveFeedback');

    try {
        const response = await fetchWithAuth(`/api/quiz/${quizId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isRandomOrder })
        });
        
        if (response.ok) {
            if(feedbackEl) {
                feedbackEl.textContent = '저장됨!';
                feedbackEl.classList.remove('opacity-0');
                setTimeout(() => {
                    feedbackEl.classList.add('opacity-0');
                }, 2000);
            }
        } else {
            if(feedbackEl) feedbackEl.textContent = '저장 실패';
            throw new Error('저장 실패');
        }
    } catch (error) {
        if(feedbackEl) {
            feedbackEl.textContent = '오류 발생';
            feedbackEl.classList.remove('opacity-0');
        }
        console.error('저장 중 오류가 발생했습니다:', error.message);
    }
}

// 초기화
(async function init() {
    const authenticated = await initNavbar();
    if (!authenticated) return;

    // 푸터 렌더링
    await renderFooter();

    if (quizId) {
        await loadQuestions();
    } else {
        alert('퀴즈 ID가 없습니다.');
        window.location.href = '/quiz/my-list';
        return;
    }

    // isRandomOrder 토글 자동 저장 리스너 추가
    const randomOrderToggle = document.getElementById('isRandomOrder');
    if (randomOrderToggle) {
        randomOrderToggle.addEventListener('change', saveRandomOrderSetting);
    }

    // 드래그 앤 드롭 설정
    setupDragAndDrop();

    // 유튜브 링크 붙여넣기 감지 설정
    setupPasteHandler();

    // 초기 폼 상태 업데이트
    updateFormVisibility();
})();

// 전역 함수 등록 (HTML에서 호출하기 위해)
window.selectQuestionType = selectQuestionType;
window.toggleMultipleChoice = toggleMultipleChoice;
window.switchView = switchView;
window.createNewQuestion = createNewQuestion;
window.editQuestion = editQuestion;
window.addAnswer = addAnswer;
window.removeAnswer = removeAnswer;
window.addIncorrect = addIncorrect;
window.removeIncorrect = removeIncorrect;
window.previewImage = previewImage;
window.removeImage = removeImage;
window.updateYoutubePreview = updateYoutubePreview;
window.updateAnswerYoutubePreview = updateAnswerYoutubePreview;
window.saveQuestion = saveQuestion;
window.deleteCurrentQuestion = deleteCurrentQuestion;
window.renderQuestions = renderQuestions;
window.extractYoutubeVideoId = extractYoutubeVideoId;
window.detectQuestionType = detectQuestionType;
window.updateFormVisibility = updateFormVisibility;
window.formatTimeOnBlur = formatTimeOnBlur;
window.saveRandomOrderSetting = saveRandomOrderSetting;