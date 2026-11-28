// 작업표시줄 창 미리보기의 재생 버튼. 아이콘은 이미지 파일 없이 코드로 그린다.

const SIZE = 32;
const TOP = 6;
const BOTTOM = 26;
const MID = (TOP + BOTTOM) / 2;

const bar = (left, right) => (x, y) => x >= left && x < right && y >= TOP && y < BOTTOM;

// base에서 tip 쪽으로 좁아지는 삼각형. tip이 base보다 왼쪽이면 왼쪽을 가리킨다.
const triangle = (base, tip) => (x, y) => {
  if (y < TOP || y >= BOTTOM) return false;
  const progress = (x - base) / (tip - base);
  return progress >= 0 && progress <= 1 - Math.abs(y - MID) / (MID - TOP);
};

const SHAPES = {
  prev: [bar(7, 11), triangle(25, 11)],
  play: [triangle(9, 26)],
  pause: [bar(8, 13), bar(19, 24)],
  next: [triangle(7, 21), bar(21, 25)],
};

// 32x32 BGRA, 배경은 투명. 밝은 작업표시줄에서는 흰색이 보이지 않아 어두운 색을 쓴다.
function drawIcon(shape, darkTaskbar = true) {
  const gray = darkTaskbar ? 255 : 32;
  const buffer = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (SHAPES[shape].some((inside) => inside(x + 0.5, y + 0.5))) {
        const at = (y * SIZE + x) * 4;
        buffer.set([gray, gray, gray, 255], at);
      }
    }
  }
  return buffer;
}

function createIcons(nativeImage, darkTaskbar = true) {
  return Object.fromEntries(
    Object.keys(SHAPES).map((shape) => [
      shape,
      nativeImage.createFromBitmap(drawIcon(shape, darkTaskbar), { width: SIZE, height: SIZE, scaleFactor: 2 }),
    ]),
  );
}

function buildButtons(t, playing, icons, actions) {
  return [
    { tooltip: t('tray.prev'), icon: icons.prev, click: actions.prev },
    { tooltip: t('tray.playPause'), icon: playing ? icons.pause : icons.play, click: actions.playPause },
    { tooltip: t('tray.next'), icon: icons.next, click: actions.next },
  ];
}

function createThumbar({ getWindow, getTranslator, getIcons, actions }) {
  let playing = false;
  function refresh() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.setThumbarButtons(buildButtons(getTranslator(), playing, getIcons(), actions));
    } catch (err) {
      console.error('Failed to set the taskbar buttons:', err);
    }
  }
  return {
    setPlaying(value) {
      playing = value;
      refresh();
    },
    refresh,
  };
}

module.exports = { drawIcon, createIcons, buildButtons, createThumbar };
