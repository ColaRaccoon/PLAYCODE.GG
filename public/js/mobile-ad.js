// 모바일 광고 렌더링 함수
export async function renderMobileAd() {
    // 모바일 기기인지 확인 (480px 이하)
    if (window.innerWidth > 480) {
        return; // 모바일이 아니면 렌더링하지 않음
    }

    const adHTML = `
        <div class="mobile-only-ad">
            <div class="flex justify-center">
                <ins class="kakao_ad_area"
                data-ad-unit = "DAN-d5NeUbk8NbihkGZm"
                data-ad-width = "320"
                data-ad-height = "100"></ins>
            </div>
        </div>
    `;

    // navbar 다음에 삽입
    const navbar = document.getElementById('navbar');
    if (navbar) {
        navbar.insertAdjacentHTML('afterend', adHTML);
    } else {
        // navbar가 없으면 body 맨 앞에 삽입
        document.body.insertAdjacentHTML('afterbegin', adHTML);
    }

    // 카카오 애드핏 스크립트 재로드 (동적으로 추가된 광고 렌더링)
    try {
        // 기존 스크립트 제거 (있다면)
        const existingScript = document.querySelector('script[src*="ba.min.js"]');

        // 새로운 스크립트 추가하여 광고 렌더링 트리거
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = '//t1.daumcdn.net/kas/static/ba.min.js';
        script.async = true;

        // 스크립트를 헤드에 추가
        document.head.appendChild(script);

    } catch (error) {
        // 광고 로드 실패는 조용히 무시 (사용자 경험에 영향 없음)
        console.debug('Ad render skipped:', error);
    }
}
