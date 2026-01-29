
    async function resizeImageToBase64(file, maxKB = 240, minKB = 40) {
    return new Promise((resolve, reject) => {
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > 6) {
        return reject(new Error('6MB를 초과한 이미지는 업로드할 수 없습니다.'));
        }

        const reader = new FileReader();

        reader.onload = function (event) {
        const img = new Image();

        img.onload = function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const tryResize = (scale = 1.0) => {
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;

            let qualities = [];

            if (sizeMB >= 4) {
                qualities = [0.3, 0.1, 0.05, 0.03];
            } else if (sizeMB >= 1) {
                qualities = [0.8, 0.7, 0.6, 0.5, 0.4];
            } else {
                qualities = [0.9, 0.85, 0.8, 0.75, 0.7];
            }

            for (let q of qualities) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const base64 = canvas.toDataURL('image/jpeg', q);
                const sizeInKB = Math.round((base64.length * 3) / 4 / 1024);

                if (sizeInKB <= maxKB && sizeInKB >= minKB) {
                console.log(`✔ 압축 성공: ${sizeInKB}KB (q=${q}, scale=${scale})`);
                resolve(base64);
                return true;
                }
            }

            return false;
            };

            // 점진적 스케일 다운
            const scales = [1.0, 0.9, 0.8, 0.7];
            for (let s of scales) {
            if (tryResize(s)) return;
            }

            // ⚠️ fallback: scale 0.5 + quality 0.3
            canvas.width = img.width * 0.5;
            canvas.height = img.height * 0.5;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const fallback = canvas.toDataURL('image/jpeg', 0.3);
            const fallbackSize = Math.round((fallback.length * 3) / 4 / 1024);
            console.warn(`⚠️ fallback 사용: ${fallbackSize}KB`);
            resolve(fallback);
        };

        img.onerror = reject;
        img.src = event.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    }

    module.exports = { resizeImageToBase64 };