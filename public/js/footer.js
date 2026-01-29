function createFooterHTML() {
    return `
    <!-- 푸터 -->
    <footer class="mt-12 pb-8 text-center text-gray-400 text-sm">
        <div class="space-x-4">
            <a href="/terms.html" class="hover:text-white transition-colors no-underline">서비스 이용약관</a>
            <span>|</span>
            <a href="/privacy-policy.html" class="hover:text-white transition-colors no-underline">개인정보 처리방침</a>
            <span>|</span>
            <a href="/contact.html" class="hover:text-white transition-colors no-underline">문의하기</a>
            <span>|</span>
            <a href="/" class="hover:text-white transition-colors no-underline">PLAYCODE.GG</a>
        </div>
        <p class="mt-2">© 2025 PLAYCODE.GG (플코지지). All rights reserved.</p>
        <p class="mt-1 text-gray-500 text-xs">Icons from <a href="https://www.figma.com/community" target="_blank" class="hover:text-gray-400 transition-colors underline">Figma Community</a></p>
        <p class="mt-2 text-gray-500 text-xs">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>
    </footer>`
}

export async function renderFooter() {

    try {
        const footerHTML = createFooterHTML();
        document.body.insertAdjacentHTML('beforeend', footerHTML)
    } catch {
        return;
    }

}