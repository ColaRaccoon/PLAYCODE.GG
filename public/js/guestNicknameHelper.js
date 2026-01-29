// guestNicknameHelper.js
// 게스트 닉네임 로컬스토리지 관리 유틸리티

const GUEST_NICKNAME_KEY = 'guestNickname';
const GUEST_ID_KEY = 'guestId';

/**
 * 로컬스토리지에서 게스트 닉네임 가져오기
 * @returns {string|null} 저장된 닉네임 또는 null
 */
export function getGuestNickname() {
  try {
    return localStorage.getItem(GUEST_NICKNAME_KEY);
  } catch (error) {
    console.error('Failed to get guest nickname from localStorage:', error);
    return null;
  }
}

/**
 * 로컬스토리지에 게스트 닉네임 저장하기
 * @param {string} nickname - 저장할 닉네임
 */
export function setGuestNickname(nickname) {
  try {
    if (nickname && nickname.trim().length > 0) {
      localStorage.setItem(GUEST_NICKNAME_KEY, nickname.trim());
    }
  } catch (error) {
    console.error('Failed to set guest nickname in localStorage:', error);
  }
}

/**
 * 로컬스토리지에서 게스트 닉네임 삭제하기
 */
export function removeGuestNickname() {
  try {
    localStorage.removeItem(GUEST_NICKNAME_KEY);
  } catch (error) {
    console.error('Failed to remove guest nickname from localStorage:', error);
  }
}

/**
 * 로컬스토리지에서 게스트 ID 가져오기
 * @returns {string|null} 저장된 게스트 ID 또는 null
 */
export function getGuestId() {
  try {
    return localStorage.getItem(GUEST_ID_KEY);
  } catch (error) {
    console.error('Failed to get guest ID from localStorage:', error);
    return null;
  }
}

/**
 * 로컬스토리지에 게스트 ID 저장하기
 * @param {string} guestId - 저장할 게스트 ID
 */
export function setGuestId(guestId) {
  try {
    if (guestId && guestId.trim().length > 0) {
      localStorage.setItem(GUEST_ID_KEY, guestId.trim());
    }
  } catch (error) {
    console.error('Failed to set guest ID in localStorage:', error);
  }
}

/**
 * 로컬스토리지에서 게스트 ID 삭제하기
 */
export function removeGuestId() {
  try {
    localStorage.removeItem(GUEST_ID_KEY);
  } catch (error) {
    console.error('Failed to remove guest ID from localStorage:', error);
  }
}

/**
 * 닉네임 모달을 표시하고 입력받기
 * @param {string|null} defaultNickname - 기본값으로 표시할 닉네임 (선택 사항)
 * @returns {Promise<string>} 입력된 닉네임
 */
export function showNicknameModal(defaultNickname = null) {
  return new Promise((resolve, reject) => {
    // 모달 HTML 생성
    const modalHTML = `
      <div id="nicknameModal" class="fixed inset-0 flex items-center justify-center p-4" style="z-index: 99999; background-color: rgba(0, 0, 0, 0.85); backdrop-filter: blur(4px);">
        <div class="rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-600" style="background-color: #2a2a3e;">
          <h2 class="text-2xl font-bold text-white mb-4 text-center">닉네임 입력</h2>
          <p class="text-gray-300 mb-6 text-center">게임에 참여하실 닉네임을 입력해주세요</p>

          <input
            type="text"
            id="nicknameInput"
            class="w-full px-4 py-3 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 mb-4"
            style="background-color: #1a1a2e; color: white;"
            placeholder="닉네임을 입력하세요"
            maxlength="20"
            value="${defaultNickname || ''}"
          />

          <div class="flex gap-3">
            <button
              id="nicknameSubmitBtn"
              class="flex-1 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105"
            >
              확인
            </button>
          </div>

          <p id="nicknameError" class="text-red-400 text-sm mt-3 hidden"></p>
        </div>
      </div>
    `;

    // 모달을 body에 추가
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const modal = document.getElementById('nicknameModal');
    const input = document.getElementById('nicknameInput');
    const submitBtn = document.getElementById('nicknameSubmitBtn');
    const errorText = document.getElementById('nicknameError');

    if (!modal || !input || !submitBtn) {
      console.error('모달 요소를 찾을 수 없음:', { modal, input, submitBtn });
      reject(new Error('모달 초기화 실패'));
      return;
    }

    // 입력 필드에 포커스
    setTimeout(() => input.focus(), 100);

    // 에러 메시지 표시 함수
    function showError(message) {
      errorText.textContent = message;
      errorText.classList.remove('hidden');
    }

    // 에러 메시지 숨기기 함수
    function hideError() {
      errorText.classList.add('hidden');
    }

    // 제출 처리 함수
    function handleSubmit() {
      const nickname = input.value.trim();

      if (!nickname) {
        showError('닉네임을 입력해주세요.');
        return;
      }

      if (nickname.length < 2) {
        showError('닉네임은 최소 2자 이상이어야 합니다.');
        return;
      }

      if (nickname.length > 20) {
        showError('닉네임은 최대 20자까지 입력 가능합니다.');
        return;
      }

      // 모달 제거
      modal.remove();

      // 닉네임 반환
      resolve(nickname);
    }

    // 확인 버튼 클릭
    submitBtn.addEventListener('click', handleSubmit);

    // Enter 키 입력
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    });

    // 입력 시 에러 숨기기
    input.addEventListener('input', hideError);
  });
}
