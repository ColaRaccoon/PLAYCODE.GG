// quiz-init-modal.js에서 필요한 함수들을 임포트
import {
  fetchWithAuth,
  uploadToS3WithPresignedUrl
} from './quiz-init-modal.js';

// 정지 알림이 이미 표시되었는지 확인하는 플래그
let suspendAlertShown = false;

export async function getUserData() {
  try {
    const response = await fetch('/auth/me', {
      credentials: 'include'
    });

    if (response.ok) {
      return await response.json();
    }

    // 403 에러인 경우 정지/탈퇴 여부 확인
    if (response.status === 403) {
      // 이미 alert를 표시했다면 중복 방지
      if (suspendAlertShown) {
        return null;
      }

      try {
        const data = await response.json();

        // 정지된 계정
        if (data.isSuspended) {
          suspendAlertShown = true; // 플래그 설정

          const suspendMessage = data.suspendedUntil
            ? `계정이 ${new Date(data.suspendedUntil).toLocaleDateString('ko-KR')}까지 정지되었습니다.`
            : '계정이 영구 정지되었습니다.';

          // alert 표시 (동기적으로 사용자가 확인할 때까지 대기)
          alert(`${suspendMessage}\n\n사유: ${data.suspendReason || '관리자 조치'}`);

          // 로그아웃 처리
          await fetch('/auth/logout', {
            method: 'POST',
            credentials: 'include'
          });

          // 메인 페이지로 리다이렉트
          window.location.href = '/';
          return null;
        }

        // 기타 403 에러 (탈퇴한 계정 등)
        if (data.message) {
          suspendAlertShown = true; // 플래그 설정

          // alert 표시
          alert(data.message);

          // 로그아웃 처리
          await fetch('/auth/logout', {
            method: 'POST',
            credentials: 'include'
          });

          // 메인 페이지로 리다이렉트
          window.location.href = '/';
          return null;
        }
      } catch (jsonError) {
        console.error('403 응답 파싱 에러:', jsonError);
      }
    }

    return null;
  } catch (err) {
    console.error('사용자 정보 로드 실패:', err);
    return null;
  }
}

// 프로필 이미지 컴포넌트 생성 함수
function createProfileImage(user) {
  const profileImageUrl = user.profileImage;
  const displayName = user.nickname || user.username;
  
  if (profileImageUrl && profileImageUrl !== 'https://ssl.pstatic.net/static/pwe/address/img_profile.png') {
    return `
      <img 
        src="${profileImageUrl}" 
        alt="${displayName}님의 프로필" 
        class="w-8 h-8 rounded-full object-cover border-2 border-white/20"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      >
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border-2 border-white/20" style="display: none;">
        ${displayName.charAt(0).toUpperCase()}
      </div>
    `;
  } else {
    return `
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border-2 border-white/20">
        ${displayName.charAt(0).toUpperCase()}
      </div>
    `;
  }
}

// 상단바 HTML 생성 함수
function createNavbarHTML(user = null) {
  return `
    <nav class="bg-[#222230] text-white shadow-lg mx-auto px-4">
      <div class="max-w-[1080px] mx-auto sm:px-0 px-4">
        <div class="flex justify-between items-center h-14 sm:h-16">
          <div class="flex items-center">
            <a href="/" class="flex items-center space-x-3 hover:opacity-80 transition-opacity flex-shrink-0">
              <img 
                src="/images/Logo.png" 
                alt="playcode 로고" 
                class="h-8 w-auto sm:h-10"
                onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';"
              >
              <span class="text-lg sm:text-xl font-bold text-white hidden" id="fallbackLogo">QQ</span>
              <div class="text-[20px] font-bold">
              PLAYCODE.GG
              </div>
            </a>
            
            ${user ? `
              <div class="hidden md:flex ml-6 lg:ml-8 space-x-4 lg:space-x-6">
                <a href="/quiz/my-list" class="hover:text-blue-200 transition-colors text-sm lg:text-base whitespace-nowrap">
                  나의 퀴즈
                </a>
                <button onclick="openCreateQuizModal()" class="hover:text-blue-200 transition-colors text-sm lg:text-base whitespace-nowrap">
                  퀴즈 만들기
                </button>
                ${user.role === 'admin' || user.role === 'superadmin' ? `
                  <a href="/admin/dashboard" class="text-red-400 hover:text-red-300 transition-colors text-sm lg:text-base whitespace-nowrap">
                    관리자 페이지
                  </a>
                ` : ''}
              </div>
            ` : ''}
          </div>
          
          <div class="hidden sm:flex items-center space-x-2 lg:space-x-4">
            ${user ? `
              <div class="flex items-center space-x-3">
                <button onclick="goToMyPage()" class="flex items-center space-x-3 hover:opacity-80 transition-opacity">
                  ${createProfileImage(user)}
                  <span class="text-xs lg:text-sm hidden md:block">
                    <span class="font-semibold">${user.nickname || user.username}</span>님
                  </span>
                </button>
              </div>
              <button 
                id="logoutBtn"
                class="bg-[#8BA2FA] hover:bg-[#617DE9] px-2 py-1 lg:px-4 lg:py-2 rounded-md transition-colors text-xs lg:text-sm font-medium"
              >
                로그아웃
              </button>
            ` : `
              <a
                href="/login"
                class="bg-[#8BA2FA] hover:bg-[#617DE9] px-2 py-1 lg:px-4 lg:py-2 rounded-md transition-colors text-xs lg:text-sm font-medium"
              >
                로그인
              </a>
              <a
                href="/signup"
                class="bg-[#8BA2FA] hover:bg-[#617DE9] px-2 py-1 lg:px-4 lg:py-2 rounded-md transition-colors text-xs lg:text-sm font-medium"
              >
                회원가입
              </a>
            `}
          </div>

          <div class="sm:hidden">
            <button 
              id="mobileMenuBtn" 
              class="p-2 rounded-md hover:bg-gray-700 transition-colors"
              aria-label="메뉴 열기"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </button>
          </div>
        </div>
        
        <div id="mobileMenu" class="sm:hidden hidden border-t border-gray-700">
          <div class="py-3 space-y-2">
            ${user ? `
              <div class="px-2 py-2 text-sm border-b border-gray-700 mb-2">
                <button onclick="goToMyPage()" class="flex items-center space-x-3 hover:bg-gray-700 rounded-md p-2 w-full text-left transition-colors">
                  ${createProfileImage(user)}
                  <span class="font-semibold">${user.nickname || user.username}</span>님
                </button>
              </div>
              
              <a href="/quiz/my-list" class="block px-2 py-2 hover:bg-gray-700 rounded-md transition-colors text-sm">
                나의 퀴즈
              </a>
              <button onclick="openCreateQuizModal()" class="w-full text-left px-2 py-2 hover:bg-gray-700 rounded-md transition-colors text-sm">
                퀴즈 만들기
              </button>
              ${user.role === 'admin' || user.role === 'superadmin' ? `
                <a href="/admin/dashboard" class="block px-2 py-2 text-red-400 hover:bg-gray-700 rounded-md transition-colors text-sm">
                  관리자 페이지
                </a>
              ` : ''}

              <button
                id="logoutBtnMobile"
                class="w-full text-left px-2 py-2 bg-red-500 hover:bg-red-600 rounded-md transition-colors text-sm font-medium mt-3"
              >
                로그아웃
              </button>
            ` : `
              <div class="space-y-2 px-2">
                <a
                  href="/login"
                  class="block w-full text-center bg-green-500 hover:bg-green-600 px-3 py-2 rounded-md transition-colors text-sm font-medium"
                >
                  로그인
                </a>
                <a
                  href="/signup"
                  class="block w-full text-center bg-blue-500 hover:bg-blue-600 px-3 py-2 rounded-md transition-colors text-sm font-medium"
                >
                  회원가입
                </a>
              </div>
            `}
          </div>
        </div>
      </div>
    </nav>
  `;
}

// 모바일 메뉴 토글 함수
function toggleMobileMenu() {
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  
  if (mobileMenu && mobileMenuBtn) {
    const isHidden = mobileMenu.classList.contains('hidden');
    
    if (isHidden) {
      mobileMenu.classList.remove('hidden');
      mobileMenuBtn.setAttribute('aria-label', '메뉴 닫기');
      mobileMenuBtn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      `;
    } else {
      mobileMenu.classList.add('hidden');
      mobileMenuBtn.setAttribute('aria-label', '메뉴 열기');
      mobileMenuBtn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
        </svg>
      `;
    }
  }
}

// 로그아웃 처리 함수
async function handleLogout() {
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });

    if (response.ok) {
      alert('로그아웃 되었습니다.');

      const currentPath = window.location.pathname;

      // 로그인이 필요한 페이지에서 로그아웃 시 메인으로 리다이렉트
      // /quiz/로 시작하거나 마이페이지, 프로필 수정 페이지
      const isProtectedPage = currentPath.startsWith('/quiz/') ||
                              currentPath === '/my-page' ||
                              currentPath === '/edit-profile';

      if (isProtectedPage) {
        window.location.href = '/';
      } else {
        window.location.reload();
      }
    } else {
      alert('로그아웃에 실패했습니다.');
    }
  } catch (err) {
    console.error('로그아웃 에러:', err);
    alert('로그아웃 중 오류가 발생했습니다.');
  }
}

// 화면 크기 변경 시 모바일 메뉴 숨기기
function handleResize() {
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  
  if (window.innerWidth >= 640 && mobileMenu && !mobileMenu.classList.contains('hidden')) {
    mobileMenu.classList.add('hidden');
    if (mobileMenuBtn) {
      mobileMenuBtn.setAttribute('aria-label', '메뉴 열기');
      mobileMenuBtn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
        </svg>
      `;
    }
  }
}

// 마이페이지로 이동하는 함수
function goToMyPage() {
  window.location.href = '/my-page';
}

// 이벤트 리스너 추가 함수
function attachNavbarListeners() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  const logoutBtnMobile = document.getElementById('logoutBtnMobile');
  if (logoutBtnMobile) {
    logoutBtnMobile.addEventListener('click', handleLogout);
  }
  
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', toggleMobileMenu);
  }
  
  window.addEventListener('resize', handleResize);
  
  const mobileMenuLinks = document.querySelectorAll('#mobileMenu a');
  mobileMenuLinks.forEach(link => {
    link.addEventListener('click', () => {
      const mobileMenu = document.getElementById('mobileMenu');
      if (mobileMenu) {
        mobileMenu.classList.add('hidden');
      }
    });
  });
  
  window.goToMyPage = goToMyPage;
}

// 메인 상단바 렌더링 함수
export async function renderNavbar() {
  try {
    const user = await getUserData();
    
    const existingNavbar = document.getElementById('navbar');
    if (existingNavbar) {
      existingNavbar.remove();
    }
    
    window.removeEventListener('resize', handleResize);
    
    const navbarHTML = createNavbarHTML(user);
    document.body.insertAdjacentHTML('afterbegin', `<div id="navbar">${navbarHTML}</div>`);
    
    attachNavbarListeners();
    
    return user;
    
  } catch (err) {
    console.error('상단바 렌더링 에러:', err);
    const navbarHTML = createNavbarHTML();
    document.body.insertAdjacentHTML('afterbegin', `<div id="navbar">${navbarHTML}</div>`);
    attachNavbarListeners();
    return null;
  }
}

// 현재 페이지 하이라이트 함수
export function highlightCurrentPage() {
  const currentPath = window.location.pathname;
  const links = document.querySelectorAll('#navbar a:not([href="/"])');
  
  links.forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('text-blue-200', 'font-semibold');
    }
  });
}

// 상단바 업데이트 함수
export async function updateNavbar() {
  const user = await renderNavbar();
  highlightCurrentPage();
  return user;
}

// ============================================
// 퀴즈 만들기 모달 (quiz-init-modal.js 로직 사용)
// ============================================

let quizTitleImageFile = null; // File 객체 저장

// 퀴즈 만들기 모달 HTML을 body에 추가하는 함수
export function initializeQuizModal() {
  if (document.getElementById('createQuizModal')) {
    return;
  }

  const modalHTML = `
    <div id="createQuizModal" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 hidden" onclick="handleQuizModalClick(event)">
      <div class="bg-[#222230] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col" onclick="event.stopPropagation()">
        <div class="bg-[#222230] border-b border-gray-600 px-6 py-4 flex justify-between items-center rounded-t-2xl flex-shrink-0">
          <h2 class="text-xl font-bold text-white">새 퀴즈 만들기</h2>
          <button onclick="closeCreateQuizModal()" class="text-gray-400 hover:text-gray-600 transition-colors">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-6 overflow-y-auto flex-1">
          <div>
            <label for="createQuizTitle" class="block text-sm font-semibold text-white mb-2">
              퀴즈 제목 <span class="text-red-500">*</span>
            </label>
            <input 
              type="text" 
              id="createQuizTitle" 
              placeholder="예: 대한민국 역사 퀴즈"
              class="w-full px-4 py-3 text-white bg-black/30 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              maxlength="100"
            >
          </div>

          <div>
            <label for="createQuizDescription" class="block text-sm font-semibold text-white mb-2">
              퀴즈 설명
            </label>
            <textarea
              id="createQuizDescription"
              placeholder="퀴즈에 대한 간단한 설명을 입력하세요 (선택사항)"
              rows="4"
              class="w-full px-4 py-3 text-white bg-black/30 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
              maxlength="100"
            ></textarea>
          </div>

          <div>
            <label for="createQuizThumbnail" class="block text-sm font-semibold text-white mb-2">
              대표 이미지 (썸네일) <span class="text-red-500">*</span>
            </label>
            <div class="space-y-3">
              <label class="flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-500 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-black/30 transition-all">
                <svg class="w-6 h-6 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
                <span class="text-gray-300 font-medium">이미지 선택하기</span>
                <input 
                  type="file" 
                  id="createQuizThumbnail" 
                  accept="image/*" 
                  onchange="handleThumbnailPreview(event)"
                  class="hidden"
                >
              </label>
              
              <div id="thumbnailPreview" class="hidden">
                <img 
                  id="thumbnailPreviewImage" 
                  alt="썸네일 미리보기"
                  class="w-full max-h-64 object-contain rounded-lg border border-gray-600"
                >
              </div>
              
              <p class="text-xs text-gray-300">
                권장: 16:9 비율, 최대 6MB
              </p>
            </div>
          </div>

          <div class="bg-amber-900/30 border border-amber-600/50 rounded-lg p-4">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
              <div class="flex-1">
                <p class="text-amber-200 text-sm font-semibold mb-1">
                  이용 약관 안내
                </p>
                <p class="text-amber-100/90 text-xs leading-relaxed">
                  PlayCode 약관에 위배되는 퀴즈( 비방성 목적, 부적절한 콘텐츠 등 )는 사전 통보 없이 삭제되거나 제재 조치가 취해질 수 있습니다. 퀴즈 생성 시 관련 법규와 약관을 준수해 주시기 바랍니다.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-[#222230] px-6 py-4 flex justify-end gap-3 rounded-b-2xl border-t border-gray-600 flex-shrink-0">
          <button
            onclick="closeCreateQuizModal()"
            class="px-6 py-2.5 border border-gray-300 text-white rounded-lg hover:bg-blue-400 hover:border-blue-400 transition-colors font-medium"
          >
            취소
          </button>
          <button
            id="createQuizBtn"
            onclick="submitCreateQuiz()"
            class="px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-md hover:shadow-lg font-medium"
          >
            퀴즈 만들기
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// 모달 배경 클릭 처리
function handleQuizModalClick(event) {
  if (event.target.id === 'createQuizModal') {
    closeCreateQuizModal();
  }
}

// 퀴즈 만들기 모달 열기 (인증 체크 추가)
export async function openCreateQuizModal() {
  // 로그인 확인
  const user = await getUserData();
  if (!user) {
    alert('로그인이 필요한 기능입니다.');
    window.location.href = '/login';
    return;
  }
  
  const modal = document.getElementById('createQuizModal');
  if (!modal) {
    initializeQuizModal();
  }
  
  // 입력 필드 초기화
  document.getElementById('createQuizTitle').value = '';
  document.getElementById('createQuizDescription').value = '';
  document.getElementById('createQuizThumbnail').value = '';
  document.getElementById('thumbnailPreview').classList.add('hidden');
  quizTitleImageFile = null;

  const modalElement = document.getElementById('createQuizModal');
  modalElement.classList.remove('hidden');
}

// 퀴즈 만들기 모달 닫기
export function closeCreateQuizModal() {
  // ObjectURL 메모리 해제
  const previewImage = document.getElementById('thumbnailPreviewImage');
  if (previewImage && previewImage.src && previewImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewImage.src);
  }

  const modal = document.getElementById('createQuizModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// 썸네일 미리보기 처리
async function handleThumbnailPreview(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    // 파일 타입 검증
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      alert('지원하지 않는 파일 형식입니다.\n\n지원 형식: JPEG, PNG, WebP, GIF');
      e.target.value = '';
      return;
    }

    // 파일 크기 검증 (10MB)
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 10) {
      alert(`파일 크기가 너무 큽니다.\n\n최대: 10MB\n현재: ${sizeMB.toFixed(2)}MB`);
      e.target.value = '';
      return;
    }

    // File 객체 저장
    quizTitleImageFile = file;

    // ObjectURL로 미리보기
    const preview = document.getElementById('thumbnailPreview');
    const previewImage = document.getElementById('thumbnailPreviewImage');

    if (previewImage.src && previewImage.src.startsWith('blob:')) {
      URL.revokeObjectURL(previewImage.src);
    }

    previewImage.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');

  } catch (error) {
    console.error('미리보기 실패:', error);
    alert('이미지 처리 실패: ' + error.message);
    e.target.value = '';
    quizTitleImageFile = null;
  }
}

// 퀴즈 생성 제출 (Presigned URL 방식)
async function submitCreateQuiz() {
  const title = document.getElementById('createQuizTitle').value.trim();
  const description = document.getElementById('createQuizDescription').value.trim();

  if (!title) {
    alert('퀴즈 제목을 입력해주세요.');
    return;
  }

  if (!quizTitleImageFile) {
    alert('썸네일 이미지를 선택해주세요.');
    return;
  }

  const createBtn = document.getElementById('createQuizBtn');
  const originalText = createBtn.innerHTML;
  createBtn.disabled = true;
  createBtn.innerHTML = '<div class="inline-flex items-center"><svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>생성 중...</div>';

  try {
    // 1단계: 퀴즈 기본 정보만 전송 (이미지 없이)
    const response = await fetchWithAuth('/api/quiz/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || '퀴즈 정보 저장 실패');
    }

    const quizId = data.quizId;

    // 2단계: Presigned URL로 썸네일 업로드
    createBtn.innerHTML = '<div class="inline-flex items-center"><svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>이미지 업로드 중...</div>';

    const thumbnailUrl = await uploadToS3WithPresignedUrl(
      quizTitleImageFile,
      'thumbnails',
      quizId
    );

    // 3단계: 서버에 썸네일 URL 업데이트
    const updateRes = await fetchWithAuth(`/api/quiz/${quizId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titleImageBase64: thumbnailUrl })
    });

    if (!updateRes.ok) {
      console.error('썸네일 URL 업데이트 실패');
    }

    // 성공 - 편집 페이지로 이동
    alert('퀴즈가 생성되었습니다!');
    closeCreateQuizModal();
    window.location.href = `/quiz/edit?quizId=${quizId}`;

  } catch (error) {
    console.error('퀴즈 생성 중 오류:', error);
    alert('퀴즈 생성 중 오류가 발생했습니다: ' + error.message);
  } finally {
    createBtn.disabled = false;
    createBtn.innerHTML = originalText;
  }
}

// 전역 함수로 등록
window.openCreateQuizModal = openCreateQuizModal;
window.closeCreateQuizModal = closeCreateQuizModal;
window.submitCreateQuiz = submitCreateQuiz;
window.handleQuizModalClick = handleQuizModalClick;
window.handleThumbnailPreview = handleThumbnailPreview;