const maxPages = 1000;

export function sidesByShape({ width, height }, referenceRatio) {
  const relativeWidth = width / height / referenceRatio;
  // Allow for bleed and cover margins. Intermediate ratios need an explicit choice.
  if (relativeWidth >= 0.8 && relativeWidth <= 1.25) return 1;
  if (relativeWidth >= 1.6 && relativeWidth <= 2.5) return 2;
  return null;
}

export async function planPdfPages(pdf, mode, referenceRatio, check = () => {}) {
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) {
    throw new Error('내지는 1~1,000쪽까지 등록할 수 있습니다.');
  }
  const sheets = [];
  let total = 0;
  for (let index = 1; index <= pdf.numPages; index++) {
    check();
    let count;
    if (mode === 'single' || mode === 'spread') {
      count = mode === 'single' ? 1 : 2;
    } else {
      if (!Number.isFinite(referenceRatio) || referenceRatio <= 0) {
        throw new Error('자동 인식하려면 재단 크기를 입력하거나 앞표지를 선택해주세요. PDF 구성을 직접 고를 수도 있습니다.');
      }
      const page = await pdf.getPage(index);
      try {
        count = sidesByShape(page.getViewport({ scale: 1 }), referenceRatio);
        if (!count) throw new Error('PDF ' + index + '페이지의 비율로 낱장과 펼침면을 구분하기 어렵습니다. 재단 크기를 확인하거나 PDF 구성을 직접 선택해주세요.');
      } finally {
        page.cleanup();
      }
    }
    total += count;
    if (total > maxPages) throw new Error('분리한 내지가 1,000쪽을 넘습니다.');
    sheets.push(count);
  }
  const layout = sheets.every(n => n === 1) ? 'single' : sheets.every(n => n === 2) ? 'spread' : 'mixed';
  return { sheets, total, layout };
}

export function* remainingPdfPages(sheets, completed) {
  let end = 0;
  for (let i = 0; i < sheets.length; i++) {
    const count = sheets[i];
    const startSide = Math.max(0, completed - end);
    end += count;
    if (startSide < count) yield { number: i + 1, count, startSide };
  }
}
