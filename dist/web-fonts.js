// Adobe's Korean subset is requested as characters appear on the page.
function loadFolioFonts() {
  window.Typekit?.load({ async: true });
}

if (window.Typekit) loadFolioFonts();
else document.getElementById('adobe-fonts').addEventListener('load', loadFolioFonts, { once: true });
