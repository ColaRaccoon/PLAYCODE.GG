// js/my-page.js

import { renderNavbar, getUserData, highlightCurrentPage } from './navbar.js';
import { renderFooter } from './footer.js';
import { renderMobileAd } from './mobile-ad.js';

// 사용자 정보 불러오기 및 표시
async function loadUserProfile() {
    const loadingSection = document.getElementById('loadingSection');
    const userInfoSection = document.getElementById('userInfoSection');
    const errorSection = document.getElementById('errorSection');

    try {
        // 사용자 기본 정보 가져오기
        const response = await fetch('/auth/me', {
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                // 로그인이 필요한 경우
                window.location.href = '/login?message=' + encodeURIComponent('로그인이 필요합니다.');
                return;
            }
            throw new Error('사용자 정보를 불러올 수 없습니다.');
        }

        const user = await response.json();
        
        // 추가 통계 정보 가져오기
        const statsResponse = await fetch('/api/user/stats', {
            credentials: 'include'
        });
        
        let stats = { createdQuizzes: 0, playedQuizzes: 0 };
        if (statsResponse.ok) {
            stats = await statsResponse.json();
        }

        // UI 업데이트
        displayUserInfo(user, stats);
        
        // 섹션 전환
        loadingSection.classList.add('hidden');
        userInfoSection.classList.remove('hidden');

    } catch (error) {
        console.error('사용자 정보 로딩 실패:', error);
        
        // 오류 섹션 표시
        loadingSection.classList.add('hidden');
        errorSection.classList.remove('hidden');
    }
}

// 사용자 정보 화면에 표시
function displayUserInfo(user, stats) {
    // 프로필 이미지 설정 (navbar와 동일한 방식)
    const profileContainer = document.getElementById('profileImageContainer');
    const displayName = user.nickname || 'Unknown';
    
    // 네이버 기본 이미지가 아니고 실제 프로필 이미지가 있는 경우
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
    } else {
        // 기본 이미지이거나 이미지가 없는 경우 - 이니셜 아바타 사용
        profileContainer.innerHTML = `
            <div class="w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                ${displayName.charAt(0).toUpperCase()}
            </div>
        `;
    }

    // 기본 정보 표시
    document.getElementById('displayNickname').textContent = user.nickname || 'Unknown';
    document.getElementById('displayEmail').textContent = user.email;
    
    // 가입일 표시
    if (user.createdAt) {
        const joinDate = new Date(user.createdAt).toLocaleDateString('ko-KR');
        document.getElementById('joinDate').textContent = `가입일: ${joinDate}`;
    }

    // 상세 정보 표시
    document.getElementById('displayUsername').textContent = user.username || '-';
    document.getElementById('displayNicknameDetail').textContent = user.nickname || '-';
    document.getElementById('displayEmailDetail').textContent = user.email || '-';

    // 활동 통계 표시
    document.getElementById('playedQuizzesCount').textContent = `${stats.playedQuizzes || 0}개`;
    document.getElementById('createdQuizzesCount').textContent = `${stats.createdQuizzes || 0}개`;

    let signupMethod = '일반 가입';
    if (user.naverId) {
        signupMethod = '네이버 연동';
    } else if (user.googleId) {
        signupMethod = '구글 연동';
    }
    document.getElementById('signupMethod').textContent = signupMethod;
}

// 내 정보 수정 페이지로 이동
function goToEditProfile() {
    // 나중에 구현할 수정 페이지로 이동
    window.location.href = '/edit-profile';
}

// 이벤트 리스너 설정
function setupEventListeners() {
    const editProfileBtn = document.getElementById('editProfileBtn');
    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', goToEditProfile);
    }
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

        // 사용자 정보 로드
        await loadUserProfile();

        // 문의 목록은 사용자가 펼쳤을 때만 로드 (접힌 상태로 시작)

    } catch (error) {
        console.error('페이지 초기화 실패:', error);

        // 오류 섹션 표시
        document.getElementById('loadingSection').classList.add('hidden');
        document.getElementById('errorSection').classList.remove('hidden');
    }
}

// ========== 나의 문의 관련 함수 ==========

// 카테고리 한글 변환
const categoryNames = {
    general: '일반 문의',
    bug: '버그 신고',
    feature: '기능 제안',
    account: '계정 관련',
    other: '기타'
};

// 상태 배지 생성
function getStatusBadge(status) {
    const badges = {
        pending: '<span class="px-2 py-1 bg-yellow-500/20 text-yellow-300 text-xs rounded-full">대기 중</span>',
        in_progress: '<span class="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full">처리 중</span>',
        resolved: '<span class="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-full">해결됨</span>',
        closed: '<span class="px-2 py-1 bg-gray-500/20 text-gray-300 text-xs rounded-full">종료됨</span>'
    };
    return badges[status] || status;
}

// 날짜 포맷
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 문의 목록 로드
async function loadUserContacts() {
    const loadingEl = document.getElementById('contactsLoading');
    const listEl = document.getElementById('contactsList');
    const emptyEl = document.getElementById('contactsEmpty');

    try {
        const response = await fetch('/api/contacts/my?page=1&limit=10', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('문의 목록을 불러올 수 없습니다.');
        }

        const data = await response.json();
        const contacts = data.contacts || [];

        loadingEl.classList.add('hidden');

        if (contacts.length === 0) {
            emptyEl.classList.remove('hidden');
            listEl.classList.add('hidden');
        } else {
            emptyEl.classList.add('hidden');
            listEl.classList.remove('hidden');

            // 문의 목록 렌더링
            listEl.innerHTML = contacts.map(contact => `
                <div class="bg-black/30 rounded-lg p-4 border border-gray-600 hover:border-blue-500 transition-colors cursor-pointer" onclick="viewContactDetail('${contact._id}')">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <h4 class="text-white font-medium">${contact.subject}</h4>
                                ${getStatusBadge(contact.status)}
                            </div>
                            <p class="text-gray-400 text-sm">${categoryNames[contact.category] || contact.category}</p>
                        </div>
                        <div class="text-gray-500 text-xs">${formatDate(contact.createdAt)}</div>
                    </div>
                    ${contact.adminResponse ? `
                        <div class="mt-3 pt-3 border-t border-gray-700">
                            <p class="text-green-300 text-sm">✓ 답변 완료</p>
                        </div>
                    ` : ''}
                </div>
            `).join('');
        }

    } catch (error) {
        console.error('문의 목록 로드 실패:', error);
        loadingEl.classList.add('hidden');
        listEl.innerHTML = `
            <div class="text-center py-8 text-red-400">
                문의 목록을 불러오는데 실패했습니다.
            </div>
        `;
    }
}

// 전역 변수로 현재 선택된 문의 저장
let currentContact = null;
let contactsLoaded = false; // 문의 목록 로드 여부

// 문의 상세 보기
async function viewContactDetail(contactId) {
    try {
        const response = await fetch('/api/contacts/my?page=1&limit=100', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('문의 정보를 불러올 수 없습니다.');
        }

        const data = await response.json();
        const contact = data.contacts.find(c => c._id === contactId);

        if (!contact) {
            alert('문의를 찾을 수 없습니다.');
            return;
        }

        currentContact = contact;

        // 모달 정보 채우기
        document.getElementById('modal-contact-category').textContent = categoryNames[contact.category] || contact.category;
        document.getElementById('modal-contact-status').innerHTML = getStatusBadge(contact.status);
        document.getElementById('modal-contact-date').textContent = formatDate(contact.createdAt);
        document.getElementById('modal-contact-subject').textContent = contact.subject;
        document.getElementById('modal-contact-message').textContent = contact.message;

        // 답변 표시
        const responseSection = document.getElementById('modal-contact-response-section');
        const pendingSection = document.getElementById('modal-contact-pending-section');

        if (contact.adminResponse) {
            responseSection.classList.remove('hidden');
            pendingSection.classList.add('hidden');
            document.getElementById('modal-contact-responded-at').textContent = formatDate(contact.respondedAt);
            document.getElementById('modal-contact-response').textContent = contact.adminResponse;
        } else {
            responseSection.classList.add('hidden');
            pendingSection.classList.remove('hidden');
        }

        // 모달 열기
        document.getElementById('contactDetailModal').classList.remove('hidden');

    } catch (error) {
        console.error('문의 상세 로드 실패:', error);
        alert('문의 정보를 불러오는데 실패했습니다.');
    }
}

// 문의 모달 닫기
function closeContactModal() {
    document.getElementById('contactDetailModal').classList.add('hidden');
    currentContact = null;
}

// 나의 문의 섹션 토글
function toggleContactsSection() {
    const content = document.getElementById('contactsContent');
    const icon = document.getElementById('contactsToggleIcon');

    if (content.classList.contains('hidden')) {
        // 펼치기
        content.classList.remove('hidden');
        icon.style.transform = 'rotate(180deg)';

        // 처음 펼칠 때만 문의 목록 로드
        if (!contactsLoaded) {
            loadUserContacts();
            contactsLoaded = true;
        }
    } else {
        // 접기
        content.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
    }
}

// 전역 함수로 등록
window.viewContactDetail = viewContactDetail;
window.closeContactModal = closeContactModal;
window.toggleContactsSection = toggleContactsSection;

// 페이지 로드 완료 시 초기화
document.addEventListener('DOMContentLoaded', initializePage);