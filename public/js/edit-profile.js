import { renderNavbar, getUserData, highlightCurrentPage } from './navbar.js';
import { renderFooter } from './footer.js';
import { renderMobileAd } from './mobile-ad.js';
import { resizeImageToBlob, uploadToS3WithPresignedUrl } from './quiz-init-modal.js';

let currentUserData = null;
let newProfileImageFile = null; // File 객체 저장
let removeCurrentImage = false;

// resizeImageToBlob는 quiz-init-modal.js에서 import

// 파일 선택 처리
async function handleImageSelection(file) {
    try {
        // 파일 크기 및 형식 검사
        if (!file.type.startsWith('image/')) {
            showAlert('error', '이미지 파일만 업로드할 수 있습니다.');
            return;
        }

        // 로딩 표시
        const previewSection = document.getElementById('imagePreviewSection');
        const newImagePreview = document.getElementById('newImagePreview');
        const imageFileInfo = document.getElementById('imageFileInfo');
        
        newImagePreview.innerHTML = `
            <div class="w-full h-full bg-gray-600 rounded-full flex items-center justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            </div>
        `;
        imageFileInfo.textContent = '이미지 처리 중...';
        previewSection.classList.remove('hidden');

        // 파일 객체 저장 (나중에 Presigned URL로 업로드)
        newProfileImageFile = file;

        // 미리보기용 Blob 생성
        const blob = await resizeImageToBlob(file, 1024, 100);
        const blobUrl = URL.createObjectURL(blob);

        // 미리보기 업데이트
        newImagePreview.innerHTML = `
            <img
                src="${blobUrl}"
                alt="새 프로필 이미지"
                class="w-full h-full rounded-full object-cover"
            >
        `;

        const fileSizeKB = Math.round(blob.size / 1024);
        imageFileInfo.textContent = `${file.name} (${fileSizeKB}KB)`;

        // 현재 이미지 제거 상태 초기화
        removeCurrentImage = false;
        
    } catch (error) {
        console.error('이미지 처리 실패:', error);
        showAlert('error', error.message || '이미지 처리 중 오류가 발생했습니다.');
        
        // 미리보기 섹션 숨기기
        document.getElementById('imagePreviewSection').classList.add('hidden');
        newProfileImageFile = null;
    }
}

// 새 이미지 제거
function removeNewImage() {
    newProfileImageFile = null;
    document.getElementById('imagePreviewSection').classList.add('hidden');
    document.getElementById('profileImageInput').value = '';
}

// 현재 이미지 제거
function removeCurrentImageHandler() {
    removeCurrentImage = true;
    newProfileImageFile = null;

    // 미리보기 업데이트
    updateProfileImagePreview();

    // 새 이미지 미리보기 숨기기
    document.getElementById('imagePreviewSection').classList.add('hidden');
    document.getElementById('profileImageInput').value = '';
}

// 프로필 이미지 미리보기 업데이트
function updateProfileImagePreview() {
    const profileContainer = document.getElementById('currentProfileImage');
    const displayName = currentUserData.nickname || currentUserData.username;
    
    if (removeCurrentImage) {
        // 기본 이미지로 표시
        profileContainer.innerHTML = `
            <div class="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                ${displayName.charAt(0).toUpperCase()}
            </div>
        `;
        
        document.getElementById('profileImageInfo').innerHTML = `
            <p class="text-yellow-400">⚠️ 현재 이미지가 제거됩니다</p>
        `;
    } else {
        // 원래 이미지 복원
        populateProfileImage(currentUserData);
    }
}

// 알림 메시지 표시
function showAlert(type, message) {
    const alertContainer = document.getElementById('alertContainer');
    const alertClass = type === 'success' ? 'alert-success' : 
                     type === 'warning' ? 'alert-warning' : 'alert-error';
    
    alertContainer.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
    
    // 성공 메시지는 3초 후 자동 제거
    if (type === 'success') {
        setTimeout(() => {
            alertContainer.innerHTML = '';
        }, 3000);
    }
    
    // 페이지 상단으로 스크롤
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 사용자 정보 불러오기 및 폼 채우기
async function loadUserData() {
    const loadingSection = document.getElementById('loadingSection');
    const editFormSection = document.getElementById('editFormSection');
    const errorSection = document.getElementById('errorSection');

    try {
        // 사용자 정보 가져오기
        const response = await fetch('/auth/me', {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login?message=' + encodeURIComponent('로그인이 필요합니다.');
                return;
            }
            throw new Error('사용자 정보를 불러올 수 없습니다.');
        }

        currentUserData = await response.json();
        
        // 폼에 데이터 채우기
        populateForm(currentUserData);
        
        // 섹션 전환
        loadingSection.classList.add('hidden');
        editFormSection.classList.remove('hidden');

    } catch (error) {
        console.error('사용자 정보 로딩 실패:', error);
        
        loadingSection.classList.add('hidden');
        errorSection.classList.remove('hidden');
    }
}

// 폼에 사용자 데이터 채우기
function populateForm(user) {
    // 프로필 이미지 설정
    populateProfileImage(user);

    // 폼 필드 채우기
    document.getElementById('username').value = user.username || '';
    document.getElementById('nickname').value = user.nickname || '';
    document.getElementById('email').value = user.email || '';

    // 닉네임 길이 표시 업데이트
    updateNicknameLength();

    // 계정 정보 표시
    const signupMethod = user.naverId ? '네이버 연동' :
                        user.googleId ? '구글 연동' : '일반 가입';
    document.getElementById('signupMethod').textContent = signupMethod;

    if (user.createdAt) {
        const joinDate = new Date(user.createdAt).toLocaleDateString('ko-KR');
        document.getElementById('joinDate').textContent = joinDate;
    }

    // OAuth 사용자인 경우 비밀번호 섹션 숨기기
    const passwordSection = document.getElementById('passwordSection');
    if (user.naverId || user.googleId) {
        passwordSection.classList.add('hidden');
    } else {
        passwordSection.classList.remove('hidden');
    }
}

// 프로필 이미지 표시
function populateProfileImage(user) {
    const profileContainer = document.getElementById('currentProfileImage');
    const displayName = user.nickname || user.username;
    
    // 프로필 이미지가 있고 네이버 기본 이미지가 아닌 경우
    if (user.profileImage && user.profileImage !== 'https://ssl.pstatic.net/static/pwe/address/img_profile.png') {
        profileContainer.innerHTML = `
            <img 
                src="${user.profileImage}" 
                alt="${displayName}님의 프로필" 
                class="w-full h-full rounded-full object-cover"
                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
            >
            <div class="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold" style="display: none;">
                ${displayName.charAt(0).toUpperCase()}
            </div>
        `;
        
        // 프로필 이미지 정보 표시
        const imageSource = user.naverId ? '네이버' :
                           user.googleId ? '구글' : '사용자';
        document.getElementById('profileImageInfo').innerHTML = `
            <p class="text-green-400">✓ ${imageSource} 프로필 이미지</p>
        `;
    } else {
        // 기본 이미지이거나 이미지가 없는 경우
        profileContainer.innerHTML = `
            <div class="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                ${displayName.charAt(0).toUpperCase()}
            </div>
        `;
        
        document.getElementById('profileImageInfo').innerHTML = `
            <p class="text-gray-400">기본 프로필 이미지</p>
        `;
    }
}

// 닉네임 길이 업데이트
function updateNicknameLength() {
    const nickname = document.getElementById('nickname').value;
    const lengthDisplay = document.getElementById('nicknameLength');
    lengthDisplay.textContent = `${nickname.length}/20`;
    
    // 글자 수에 따른 색상 변경
    if (nickname.length > 20) {
        lengthDisplay.className = 'text-xs text-red-400';
    } else if (nickname.length >= 15) {
        lengthDisplay.className = 'text-xs text-yellow-400';
    } else {
        lengthDisplay.className = 'text-xs text-gray-500';
    }
}

// 폼 유효성 검사
function validateForm(data) {
    // 닉네임 검사
    if (!data.nickname || data.nickname.trim().length < 2) {
        showAlert('error', '닉네임은 2글자 이상이어야 합니다.');
        return false;
    }
    
    if (data.nickname.trim().length > 20) {
        showAlert('error', '닉네임은 20글자 이하여야 합니다.');
        return false;
    }

    // 비밀번호 변경 시 검사
    if (data.newPassword || data.currentPassword || data.confirmPassword) {
        if (!data.currentPassword) {
            showAlert('error', '현재 비밀번호를 입력해주세요.');
            return false;
        }
        
        if (!data.newPassword) {
            showAlert('error', '새 비밀번호를 입력해주세요.');
            return false;
        }
        
        if (data.newPassword.length < 6) {
            showAlert('error', '새 비밀번호는 6글자 이상이어야 합니다.');
            return false;
        }
        
        if (data.newPassword !== data.confirmPassword) {
            showAlert('error', '새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
            return false;
        }
    }

    return true;
}

// 폼 제출 처리
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    // 로딩 상태
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중...';
    
    try {
        // 폼 데이터 수집
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        // 유효성 검사
        if (!validateForm(data)) {
            return;
        }
        
        // 변경되지 않은 필드 제거
        const updateData = {};
        
        // 닉네임이 변경된 경우에만 포함
        if (data.nickname !== currentUserData.nickname) {
            updateData.nickname = data.nickname.trim();
        }
        
        // 프로필 이미지 변경사항
        if (newProfileImageFile) {
            // Presigned URL로 S3에 업로드
            submitBtn.textContent = '이미지 업로드 중...';
            const profileImageUrl = await uploadToS3WithPresignedUrl(
                newProfileImageFile,
                'profiles',
                currentUserData._id || 'user'
            );
            updateData.profileImage = profileImageUrl;
            submitBtn.textContent = '저장 중...';
        } else if (removeCurrentImage) {
            updateData.removeProfileImage = true;
        }
        
        // 비밀번호 변경이 있는 경우에만 포함
        if (data.newPassword) {
            updateData.currentPassword = data.currentPassword;
            updateData.newPassword = data.newPassword;
        }
        
        // 변경사항이 없는 경우
        if (Object.keys(updateData).length === 0) {
            showAlert('warning', '변경된 정보가 없습니다.');
            return;
        }
        
        // 서버에 업데이트 요청
        const response = await fetch('/auth/update-profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData),
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showAlert('success', '정보가 성공적으로 업데이트되었습니다!');
            
            // 현재 사용자 데이터 업데이트
            if (updateData.nickname) {
                currentUserData.nickname = updateData.nickname;
            }
            if (updateData.profileImage) {
                currentUserData.profileImage = updateData.profileImage;
            }
            if (updateData.removeProfileImage) {
                currentUserData.profileImage = null;
            }
            
            // 상태 초기화
            newProfileImageFile = null;
            removeCurrentImage = false;
            
            // 비밀번호 필드 초기화
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            
            // UI 업데이트
            document.getElementById('imagePreviewSection').classList.add('hidden');
            populateProfileImage(currentUserData);
            
            // 2초 후 마이페이지로 이동
            setTimeout(() => {
                window.location.href = '/my-page';
            }, 2000);
            
        } else {
            showAlert('error', result.message || '정보 업데이트에 실패했습니다.');
        }
        
    } catch (error) {
        console.error('프로필 업데이트 실패:', error);
        showAlert('error', '네트워크 오류가 발생했습니다. 다시 시도해주세요.');
        
    } finally {
        // 버튼 상태 복원
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// 실시간 유효성 검사
function setupRealtimeValidation() {
    const nicknameInput = document.getElementById('nickname');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    
    // 닉네임 길이 실시간 업데이트
    nicknameInput.addEventListener('input', updateNicknameLength);
    
    // 닉네임 유효성 검사
    nicknameInput.addEventListener('blur', function() {
        const value = this.value.trim();
        if (value && (value.length < 2 || value.length > 20)) {
            this.style.borderColor = '#ef4444';
        } else {
            this.style.borderColor = '#4b5563';
        }
    });
    
    // 비밀번호 확인 실시간 검사
    confirmPasswordInput.addEventListener('input', function() {
        const newPassword = newPasswordInput.value;
        const confirmPassword = this.value;
        
        if (confirmPassword && newPassword !== confirmPassword) {
            this.style.borderColor = '#ef4444';
        } else {
            this.style.borderColor = '#4b5563';
        }
    });
    
    // 포커스 시 테두리 색상 복원
    [nicknameInput, newPasswordInput, confirmPasswordInput].forEach(input => {
        input.addEventListener('focus', function() {
            this.style.borderColor = '#10b981';
        });
    });
}

// 회원 탈퇴 처리
async function handleDeleteAccount() {
    // 1차 확인: 경고 메시지와 함께 확인
    const confirmed = confirm(
        '정말로 회원 탈퇴하시겠습니까?\n\n' +
        '⚠️ 탈퇴 시 주의사항:\n' +
        '• 즉시 로그인이 불가능합니다\n' +
        '• 작성한 모든 퀴즈가 자동으로 비공개 처리됩니다\n' +
        '• 퀴즈 및 활동 기록은 DB에 6개월간 보관됩니다\n' +
        '• 6개월 후 모든 정보가 영구 삭제됩니다\n' +
        '• 법적 분쟁 시 수사기관에 정보가 제공될 수 있습니다\n\n' +
        '이 작업은 되돌릴 수 없습니다.'
    );

    if (!confirmed) return;

    // 2차 확인: "탈퇴" 텍스트 입력 요구
    const doubleCheck = prompt(
        '정말로 탈퇴하시겠습니까?\n\n' +
        '계속 진행하려면 아래 텍스트를 정확히 입력해주세요:\n\n' +
        '탈퇴'
    );

    if (doubleCheck !== '탈퇴') {
        if (doubleCheck !== null) {
            showAlert('warning', '입력한 텍스트가 일치하지 않습니다. 탈퇴가 취소되었습니다.');
        }
        return;
    }

    try {
        const response = await fetch('/auth/delete-account', {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok) {
            // 성공 시 메시지 표시 후 메인 페이지로 이동
            alert(
                '회원 탈퇴가 완료되었습니다.\n\n' +
                '그동안 PlayCode를 이용해주셔서 감사합니다.\n' +
                `작성하신 콘텐츠는 ${new Date(data.deletionScheduledAt).toLocaleDateString('ko-KR')}까지 보관됩니다.`
            );
            window.location.href = '/';
        } else {
            showAlert('error', data.message || '회원 탈퇴 중 오류가 발생했습니다.');
        }

    } catch (error) {
        console.error('회원 탈퇴 실패:', error);
        showAlert('error', '네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    }
}

// 이벤트 리스너 설정
function setupEventListeners() {
    const editForm = document.getElementById('editProfileForm');
    if (editForm) {
        editForm.addEventListener('submit', handleFormSubmit);
    }

    // 프로필 이미지 변경 버튼
    const changeImageBtn = document.getElementById('changeImageBtn');
    const profileImageInput = document.getElementById('profileImageInput');

    if (changeImageBtn && profileImageInput) {
        changeImageBtn.addEventListener('click', () => {
            profileImageInput.click();
        });

        profileImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleImageSelection(file);
            }
        });
    }

    // 새 이미지 제거 버튼
    const removeNewImageBtn = document.getElementById('removeNewImageBtn');
    if (removeNewImageBtn) {
        removeNewImageBtn.addEventListener('click', removeNewImage);
    }

    // 현재 이미지 제거 버튼
    const removeCurrentImageBtn = document.getElementById('removeCurrentImageBtn');
    if (removeCurrentImageBtn) {
        removeCurrentImageBtn.addEventListener('click', removeCurrentImageHandler);
    }

    // 회원 탈퇴 버튼
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', handleDeleteAccount);
    }

    // 실시간 유효성 검사 설정
    setupRealtimeValidation();
}

// 페이지 초기화
async function initializePage() {
    try {
        // 상단바 렌더링
        const user = await renderNavbar();
        highlightCurrentPage();

        // 모바일 광고 렌더링
        await renderMobileAd();

        // 푸터 렌더링
        await renderFooter();

        // 로그인 체크
        if (!user) {
            window.location.href = '/login?message=' + encodeURIComponent('로그인이 필요합니다.');
            return;
        }
        
        // 이벤트 리스너 설정
        setupEventListeners();
        
        // 사용자 데이터 로드
        await loadUserData();
        
    } catch (error) {
        console.error('페이지 초기화 실패:', error);
        
        document.getElementById('loadingSection').classList.add('hidden');
        document.getElementById('errorSection').classList.remove('hidden');
    }
}

// 페이지 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);