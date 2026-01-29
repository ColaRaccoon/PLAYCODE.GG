// admin-users.js
import { renderNavbar, highlightCurrentPage } from './navbar.js';
import { uploadToS3WithPresignedUrl } from './quiz-init-modal.js';
import { renderFooter } from './footer.js';

let allUsers = [];
let currentPage = 1;
let isLoading = false;
let hasMore = true;
let currentUser = null; // 현재 로그인한 관리자 정보
let currentSearchTerm = ''; // 현재 검색어
let currentFilterRole = 'all'; // 현재 필터 역할

// 프로필 이미지 변경 관련 변수
let currentEditUserId = null;
let newProfileImageFile = null; // File 객체 저장
let newProfileImageUrl = null; // S3 URL 또는 기존 URL 저장

// 토큰 인증이 포함된 fetch 함수
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
      alert('세션이 만료되었습니다. 다시 로그인해주세요.');
      window.location.href = '/login';
      return;
    }
  }
  return response;
}

// 페이지 초기화
async function initializePage() {
  try {
    // 네비바 렌더링
    const user = await renderNavbar();
    highlightCurrentPage();

    // 푸터 렌더링
    await renderFooter();

    if (!user) {
      alert('로그인이 필요합니다.');
      window.location.href = '/login';
      return;
    }

    // 관리자 권한 체크
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      alert('관리자 권한이 필요합니다.');
      window.location.href = '/';
      return;
    }

    // 현재 사용자 정보 저장
    currentUser = user;

    // 유저 목록 로드
    await loadUsers();

    // 검색 이벤트 리스너 설정
    setupSearchListeners();

    // 무한 스크롤 이벤트 리스너 추가
    window.addEventListener('scroll', handleScroll);
  } catch (error) {
    console.error('페이지 초기화 실패:', error);
    alert('페이지 초기화 중 오류가 발생했습니다.');
  }
}

// 유저 목록 로드
async function loadUsers(reset = false) {
  if (isLoading || (!hasMore && !reset)) return;

  try {
    isLoading = true;

    // 리셋 시 초기화
    if (reset) {
      currentPage = 1;
      allUsers = [];
      hasMore = true;
    }

    // 로딩 인디케이터 표시
    if (currentPage === 1) {
      document.getElementById('loadingState').classList.remove('hidden');
      document.getElementById('userTableContainer').classList.add('hidden');
    } else {
      showLoadMoreIndicator();
    }

    // 검색어가 있으면 검색 API, 없으면 일반 목록 API
    let url;
    if (currentSearchTerm) {
      url = `/admin/users/search?q=${encodeURIComponent(currentSearchTerm)}&page=${currentPage}&limit=10&role=${currentFilterRole}`;
    } else {
      url = `/admin/users?page=${currentPage}&limit=10&role=${currentFilterRole}`;
    }

    const response = await fetchWithAuth(url);

    if (!response.ok) {
      if (response.status === 403) {
        alert('관리자 권한이 필요합니다.');
        window.location.href = '/';
        return;
      }
      throw new Error('유저 목록 로드 실패');
    }

    const data = await response.json();

    // 새로운 유저 추가
    allUsers = [...allUsers, ...data.users];
    hasMore = data.pagination.hasMore;

    // 테이블 렌더링
    renderUserTable(allUsers);

    // 로딩 상태 숨기고 테이블 표시
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('userTableContainer').classList.remove('hidden');
    hideLoadMoreIndicator();

    // 다음 페이지 준비
    currentPage++;
  } catch (err) {
    console.error('유저 로드 에러:', err);
    if (currentPage === 1) {
      document.getElementById('loadingState').innerHTML = `
        <p class="text-red-400">유저 목록을 불러오는데 실패했습니다.</p>
        <button onclick="location.reload()" class="mt-4 bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg">
          다시 시도
        </button>
      `;
    }
    hideLoadMoreIndicator();
  } finally {
    isLoading = false;
  }
}

// 유저 테이블 렌더링
function renderUserTable(users) {
  const tbody = document.getElementById('userList');
  tbody.innerHTML = '';

  if (users.length === 0) {
    document.getElementById('userTableContainer').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
    return;
  }

  document.getElementById('userTableContainer').classList.remove('hidden');
  document.getElementById('emptyState').classList.add('hidden');

  users.forEach(user => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-700 hover:bg-gray-800/50 transition-colors';

    const createdDate = new Date(user.createdAt).toLocaleDateString('ko-KR');
    const isSuspended = user.isSuspended;
    const suspendedUntil = user.suspendedUntil ? new Date(user.suspendedUntil).toLocaleDateString('ko-KR') : null;

    // 가입 방법 표시
    let signupMethod = '일반';
    if (user.googleId) signupMethod = '구글';
    else if (user.kakaoId) signupMethod = '카카오';

    // 역할 표시
    let roleDisplay = '사용자';
    let roleColor = 'bg-gray-500/20 text-gray-400 border-gray-500';
    if (user.role === 'admin') {
      roleDisplay = '관리자';
      roleColor = 'bg-blue-500/20 text-blue-400 border-blue-500';
    } else if (user.role === 'superadmin') {
      roleDisplay = '최고관리자';
      roleColor = 'bg-purple-500/20 text-purple-400 border-purple-500';
    }

    const nickname = user.nickname || 'Unknown';
    const nicknameEscaped = nickname.replace(/'/g, "\\'");

    tr.innerHTML = `
      <td class="p-3">
        <div class="flex items-center justify-center">
          ${user.profileImage ? `
            <img src="${user.profileImage}" alt="프로필" class="w-12 h-12 rounded-full object-cover cursor-pointer border-2 border-purple-500/50" onclick="openProfileImageModal('${user._id}')">
          ` : `
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold cursor-pointer" onclick="openProfileImageModal('${user._id}')">
              ${nickname.charAt(0).toUpperCase()}
            </div>
          `}
        </div>
      </td>
      <td class="p-3 text-gray-300">${user.username || '-'}</td>
      <td class="p-3">
        <div
          class="text-white cursor-pointer hover:text-purple-400 transition-colors"
          onclick="changeUserNickname('${user._id}', '${nicknameEscaped}')"
          title="클릭하여 닉네임 수정"
        >
          ${nickname}
        </div>
      </td>
      <td class="p-3 text-gray-300">${user.email}</td>
      <td class="p-3">
        <span class="px-2 py-1 rounded text-xs font-semibold ${roleColor} border whitespace-nowrap">
          ${signupMethod}
        </span>
      </td>
      <td class="p-3 text-gray-300 text-sm whitespace-nowrap">${createdDate}</td>
      <td class="p-3 whitespace-nowrap">
        ${isSuspended ? `
          <div class="space-y-1">
            <span class="px-2 py-1 rounded text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500">
              정지됨
            </span>
            ${suspendedUntil ? `
              <div class="text-xs text-gray-400">
                ${suspendedUntil}까지
              </div>
            ` : `
              <div class="text-xs text-gray-400">
                영구 정지
              </div>
            `}
          </div>
        ` : `
          <span class="px-2 py-1 rounded text-xs font-semibold bg-green-500/20 text-green-400 border border-green-500">
            정상
          </span>
        `}
      </td>
      <td class="p-3">
        <div class="flex flex-col gap-1 items-center">
          ${user.role !== 'superadmin' || (currentUser && currentUser.role === 'superadmin') ? `
            <button
              onclick="suspendUser('${user._id}', '${nicknameEscaped}')"
              class="border border-gray-600 hover:bg-yellow-400 text-white px-3 py-1 rounded-lg shadow transition-colors text-xs whitespace-nowrap"
            >
              ${isSuspended ? '정지해제' : '정지'}
            </button>
          ` : ''}
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// 검색 실행 함수
async function searchUsers() {
  const searchInput = document.getElementById('searchInput');
  currentSearchTerm = searchInput.value.trim();
  currentFilterRole = document.getElementById('filterRole').value;

  await loadUsers(true); // 리셋하고 다시 로드
}

// 검색 초기화 (역할 필터 변경 시)
async function changeFilterRole() {
  currentFilterRole = document.getElementById('filterRole').value;

  // 필터가 변경되면 항상 다시 로드 (검색어 유무 관계없이)
  await loadUsers(true); // 리셋하고 다시 로드
}

// 검색 이벤트 리스너 설정
function setupSearchListeners() {
  const searchBtn = document.getElementById('searchBtn');
  const searchInput = document.getElementById('searchInput');
  const filterRole = document.getElementById('filterRole');

  // 검색 버튼 클릭
  if (searchBtn) {
    searchBtn.addEventListener('click', searchUsers);
  }

  // 엔터 키로 검색
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchUsers();
      }
    });
  }

  // 역할 필터 변경
  if (filterRole) {
    filterRole.addEventListener('change', changeFilterRole);
  }
}

// 사용자 닉네임 변경
async function changeUserNickname(userId, currentNickname) {
  const newNickname = prompt(`"${currentNickname}" 사용자의 닉네임을 변경하시겠습니까?\n\n새 닉네임을 입력하세요 (2-20자):`, currentNickname);

  if (newNickname === null) {
    return;
  }

  const trimmedNickname = newNickname.trim();

  if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
    alert('닉네임은 2자 이상 20자 이하로 입력해주세요.');
    return;
  }

  if (trimmedNickname === currentNickname) {
    alert('기존 닉네임과 동일합니다.');
    return;
  }

  if (!confirm(`닉네임을 "${currentNickname}"에서 "${trimmedNickname}"으로 변경하시겠습니까?`)) {
    return;
  }

  try {
    const response = await fetchWithAuth(`/admin/users/${userId}/nickname`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: trimmedNickname })
    });

    const data = await response.json();

    if (response.ok) {
      alert(data.message);
      await loadUsers(true); // 목록 새로고침
    } else {
      alert(data.message || '닉네임 변경 중 오류가 발생했습니다.');
    }
  } catch (err) {
    console.error('User nickname change error:', err);
    alert('닉네임 변경 중 오류가 발생했습니다.');
  }
}

// 사용자 정지/정지 해제
async function suspendUser(userId, nickname) {
  try {
    // 먼저 사용자 정보를 가져와서 현재 정지 상태 확인
    const userResponse = await fetchWithAuth(`/admin/users/${userId}`);
    if (!userResponse.ok) {
      throw new Error('사용자 정보를 가져올 수 없습니다.');
    }
    const userData = await userResponse.json();

    if (userData.isSuspended) {
      // 정지 해제
      if (!confirm(`"${nickname}" 사용자의 정지를 해제하시겠습니까?`)) {
        return;
      }

      const response = await fetchWithAuth(`/admin/users/${userId}/unsuspend`, {
        method: 'POST'
      });

      const data = await response.json();

      if (response.ok) {
        alert(data.message);
        await loadUsers(true); // 목록 새로고침
      } else {
        alert(data.message || '정지 해제 중 오류가 발생했습니다.');
      }
    } else {
      // 정지
      const daysInput = prompt(`"${nickname}" 사용자를 정지하시겠습니까?\n\n정지 기간을 일수로 입력하세요.\n(빈 칸 또는 0 입력 시 영구 정지)`);

      if (daysInput === null) {
        return;
      }

      const days = daysInput.trim() === '' || daysInput.trim() === '0' ? null : parseInt(daysInput);

      if (days !== null && (isNaN(days) || days < 1)) {
        alert('유효한 일수를 입력해주세요. (1 이상의 숫자 또는 빈 칸)');
        return;
      }

      const reason = prompt('정지 사유를 입력하세요 (선택사항):');

      if (reason === null) {
        return;
      }

      const confirmMessage = days
        ? `"${nickname}" 사용자를 ${days}일간 정지하시겠습니까?`
        : `"${nickname}" 사용자를 영구 정지하시겠습니까?`;

      if (!confirm(confirmMessage)) {
        return;
      }

      const response = await fetchWithAuth(`/admin/users/${userId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days,
          reason: reason || '관리자 조치'
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert(data.message);
        await loadUsers(true); // 목록 새로고침
      } else {
        alert(data.message || '사용자 정지 처리 중 오류가 발생했습니다.');
      }
    }
  } catch (err) {
    console.error('User suspend/unsuspend error:', err);
    alert('정지 처리 중 오류가 발생했습니다.');
  }
}

// 프로필 이미지 변경 모달 열기
async function openProfileImageModal(userId) {
  try {
    currentEditUserId = userId;
    newProfileImageFile = null;
    newProfileImageUrl = null;

    // 사용자 정보 가져오기
    const response = await fetchWithAuth(`/admin/users/${userId}`);
    if (!response.ok) {
      throw new Error('사용자 정보를 불러오는데 실패했습니다.');
    }

    const user = await response.json();

    // 현재 프로필 이미지 설정
    const currentProfileImage = document.getElementById('currentProfileImage');
    const userNickname = user.nickname || 'Unknown';

    if (user.profileImage) {
      currentProfileImage.innerHTML = `<img src="${user.profileImage}" class="w-24 h-24 rounded-full object-cover">`;
    } else {
      currentProfileImage.innerHTML = userNickname.charAt(0).toUpperCase();
      currentProfileImage.className = 'w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold border-4 border-white/20';
    }

    // 새 이미지 미리보기 섹션 숨김
    document.getElementById('newProfilePreviewSection').classList.add('hidden');

    // 모달 열기
    document.getElementById('profileImageModal').classList.remove('hidden');
    document.getElementById('profileImageModal').classList.add('flex');

  } catch (error) {
    console.error('모달 열기 실패:', error);
    alert('사용자 정보를 불러오는데 실패했습니다.');
  }
}

// 프로필 이미지 변경 모달 닫기
function closeProfileImageModal() {
  currentEditUserId = null;
  newProfileImageFile = null;
  newProfileImageUrl = null;

  // ObjectURL 메모리 해제
  const preview = document.getElementById('newProfilePreview');
  if (preview && preview.src && preview.src.startsWith('blob:')) {
    URL.revokeObjectURL(preview.src);
  }

  document.getElementById('profileImageModal').classList.add('hidden');
  document.getElementById('profileImageModal').classList.remove('flex');
  document.getElementById('newProfileImageInput').value = '';
  document.getElementById('newProfilePreviewSection').classList.add('hidden');
}

// 프로필 이미지 변경 핸들러
async function handleProfileImageChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    // 파일 타입 검증
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      alert('지원하지 않는 파일 형식입니다.\n\n지원 형식: JPEG, PNG, WebP, GIF');
      event.target.value = '';
      return;
    }

    // 파일 크기 검증 (10MB)
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 10) {
      alert(`파일 크기가 너무 큽니다.\n\n최대: 10MB\n현재: ${sizeMB.toFixed(2)}MB`);
      event.target.value = '';
      return;
    }

    // File 객체 저장
    newProfileImageFile = file;

    // ObjectURL로 미리보기
    const preview = document.getElementById('newProfilePreview');
    if (preview.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }

    preview.src = URL.createObjectURL(file);
    document.getElementById('newProfilePreviewSection').classList.remove('hidden');

  } catch (error) {
    console.error('이미지 처리 실패:', error);
    alert('이미지 처리 실패: ' + error.message);
    event.target.value = '';
    newProfileImageFile = null;
  }
}

// 프로필 이미지 저장
async function saveProfileImage() {
  if (!newProfileImageFile) {
    alert('새 프로필 이미지를 선택해주세요.');
    return;
  }

  try {
    // S3에 업로드
    const profileImageUrl = await uploadToS3WithPresignedUrl(
      newProfileImageFile,
      'profiles',
      currentEditUserId
    );

    const response = await fetchWithAuth(`/admin/users/${currentEditUserId}/profile-image`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileImageBase64: profileImageUrl
      })
    });

    const result = await response.json();

    if (response.ok) {
      alert('프로필 이미지가 변경되었습니다.');
      closeProfileImageModal();
      await loadUsers(true); // 목록 새로고침
    } else {
      alert(result.message || '프로필 이미지 변경에 실패했습니다.');
    }
  } catch (error) {
    console.error('프로필 이미지 변경 실패:', error);
    alert('프로필 이미지 변경 중 오류가 발생했습니다.');
  }
}

// 무한 스크롤 핸들러
function handleScroll() {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight;
  const clientHeight = document.documentElement.clientHeight;

  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadUsers();
  }
}

// 로딩 인디케이터 표시
function showLoadMoreIndicator() {
  let indicator = document.getElementById('loadMoreIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'loadMoreIndicator';
    indicator.className = 'text-center py-8';
    indicator.innerHTML = `
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      <p class="text-gray-400 mt-2">추가 유저를 불러오는 중...</p>
    `;
    document.getElementById('userTableContainer').appendChild(indicator);
  }
  indicator.classList.remove('hidden');
}

// 로딩 인디케이터 숨기기
function hideLoadMoreIndicator() {
  const indicator = document.getElementById('loadMoreIndicator');
  if (indicator) {
    indicator.classList.add('hidden');
  }
}

// 전역 함수로 등록
window.changeUserNickname = changeUserNickname;
window.suspendUser = suspendUser;
window.openProfileImageModal = openProfileImageModal;
window.closeProfileImageModal = closeProfileImageModal;
window.handleProfileImageChange = handleProfileImageChange;
window.saveProfileImage = saveProfileImage;

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);
