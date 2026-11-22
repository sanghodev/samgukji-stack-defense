import Phaser from 'phaser';

/**
 * Generates crisp 16-bit chibi pixel-art spritesheets for Step 4:
 * 1. `zhangfei_sheet` (8 frames of 128x128):
 *    0: Idle, 1: Run A, 2: Run B, 3: Swing 1, 4: Heavy Smash,
 *    5: Charge Anticipation (Roar!), 6: Bulldozer Charge Rush, 7: Charge Skid
 * 2. `bandit_splat_face` (240x240):
 *    Comedic squashed chibi bandit face pressed flat against the camera glass!
 */
export function generateStep4Sprites(scene: Phaser.Scene): void {
  if (!scene.textures.exists('zhangfei_sheet')) {
    buildZhangFeiSpritesheet(scene);
  }
  if (!scene.textures.exists('bandit_splat_face')) {
    buildBanditSplatFace(scene);
  }
}

function buildZhangFeiSpritesheet(scene: Phaser.Scene): void {
  const fw = 128;
  const fh = 128;
  const frames = 8;
  const canvas = document.createElement('canvas');
  canvas.width = fw * frames;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  for (let f = 0; f < frames; f++) {
    ctx.save();
    ctx.translate(f * fw, 0);
    drawZhangFeiFrame(ctx, fw, fh, f);
    ctx.restore();
  }

  scene.textures.addSpriteSheet(
    'zhangfei_sheet',
    canvas as unknown as HTMLImageElement,
    { frameWidth: fw, frameHeight: fh },
  );
}

function drawZhangFeiFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number,
): void {
  const cx = w / 2;
  const footY = h - 14;

  // Frame-specific pose offsets
  const isRunA = frame === 1;
  const isRunB = frame === 2;
  const isSwing = frame === 3;
  const isHeavy = frame === 4;
  const isRoar = frame === 5;
  const isCharge = frame === 6;
  const isSkid = frame === 7;

  const bodyShiftX = isCharge ? 8 : isSkid ? -6 : isHeavy ? 6 : 0;
  const bodyShiftY = isRoar ? 7 : isCharge ? 4 : isRunA ? -3 : isRunB ? 2 : 0;

  // 1. Purple/gold billowing cloak behind
  ctx.fillStyle = '#581c87';
  ctx.strokeStyle = '#1e1028';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 12 + bodyShiftX, footY - 42 + bodyShiftY);
  ctx.lineTo(cx - (isCharge ? 44 : 30) + bodyShiftX, footY - (isCharge ? 28 : 14) + bodyShiftY);
  ctx.lineTo(cx - 6 + bodyShiftX, footY - 12 + bodyShiftY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 2. Boots (chunky armored boots)
  const leftFootX = cx - 12 + (isRunA ? -8 : isRunB ? 7 : isCharge ? -10 : 0);
  const rightFootX = cx + 10 + (isRunA ? 9 : isRunB ? -6 : isCharge ? 12 : 0);
  drawRoundedBox(ctx, leftFootX - 8, footY - 14, 16, 13, '#3b1d5a', '#1e1028');
  drawRoundedBox(ctx, rightFootX - 8, footY - 14, 16, 13, '#3b1d5a', '#1e1028');
  // Gold boot trim
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(leftFootX - 7, footY - 14, 14, 3);
  ctx.fillRect(rightFootX - 7, footY - 14, 14, 3);

  // 3. Strong compact armored torso (purple & gold)
  const torsoX = cx - 22 + bodyShiftX;
  const torsoY = footY - 48 + bodyShiftY;
  drawRoundedBox(ctx, torsoX, torsoY, 44, 36, '#6b21a8', '#1e1028');
  // Gold chest armor plates & tiger belt buckle
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(torsoX + 5, torsoY + 6, 34, 8);
  ctx.fillStyle = '#fde047';
  ctx.fillRect(torsoX + 14, torsoY + 22, 16, 9);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(torsoX + 4, torsoY + 24, 10, 5);
  ctx.fillRect(torsoX + 30, torsoY + 24, 10, 5);

  // Broad golden shoulder pauldrons (lowered forward during charge!)
  const pauldronY = torsoY + (isCharge ? 4 : isRoar ? 5 : 0);
  drawCircle(ctx, torsoX + 2, pauldronY + 8, 12, '#9333ea', '#1e1028');
  drawCircle(ctx, torsoX + 42, pauldronY + 8, 12, '#9333ea', '#1e1028');
  drawCircle(ctx, torsoX + 2, pauldronY + 6, 7, '#fbbf24', '#78350f');
  drawCircle(ctx, torsoX + 42, pauldronY + 6, 7, '#fbbf24', '#78350f');

  // 4. Signature Serpent Spear (사모 / Wavy Snake-Blade Halberd!)
  ctx.save();
  ctx.translate(cx + bodyShiftX, torsoY + 14);
  const spearAngle = isCharge
    ? 0.04
    : isRoar
      ? -0.85
      : isSwing
        ? 0.22
        : isHeavy
          ? 0.08
          : -0.35;
  ctx.rotate(spearAngle);

  // Wooden shaft
  ctx.fillStyle = '#78350f';
  ctx.strokeStyle = '#1c120c';
  ctx.lineWidth = 2.5;
  ctx.fillRect(-34, -3, 76, 6);
  ctx.strokeRect(-34, -3, 76, 6);

  // Red tassel
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(36, 3);
  ctx.lineTo(31, 14);
  ctx.lineTo(42, 12);
  ctx.closePath();
  ctx.fill();

  // Wavy Serpent Spear blade (사모)
  ctx.fillStyle = isCharge || isHeavy ? '#fde047' : '#e2e8f0';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(38, -5);
  ctx.quadraticCurveTo(46, -12, 52, -3);
  ctx.quadraticCurveTo(57, 6, 64, 0);
  ctx.quadraticCurveTo(56, 9, 49, 4);
  ctx.quadraticCurveTo(44, 11, 38, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 5. Big Adorable 2-Head-Tall Chibi Head
  const headX = cx + bodyShiftX + (isCharge ? 6 : 0);
  const headY = torsoY - 22;

  // Spiky wild dark hair back
  ctx.fillStyle = '#18181b';
  ctx.strokeStyle = '#09090b';
  ctx.lineWidth = 3;
  drawCircle(ctx, headX, headY - 2, 27, '#18181b', '#09090b');

  // Face skin
  drawCircle(ctx, headX + 2, headY + 3, 21, '#f3b78b', '#451a03');

  // Gold & crimson warrior headband / crown
  drawRoundedBox(ctx, headX - 22, headY - 19, 44, 10, '#7e22ce', '#1e1028');
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(headX - 8, headY - 23, 16, 12);
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 2;
  ctx.strokeRect(headX - 8, headY - 23, 16, 12);

  // Fierce funny wide eyes & thick angry eyebrows
  ctx.fillStyle = '#ffffff';
  drawCircle(ctx, headX - 6, headY, 5.5, '#ffffff', '#1c120c');
  drawCircle(ctx, headX + 10, headY, 5.5, '#ffffff', '#1c120c');
  ctx.fillStyle = '#111827';
  ctx.fillRect(headX - 5, headY - 2, 4, 4);
  ctx.fillRect(headX + 11, headY - 2, 4, 4);

  // Thick V-shaped eyebrows
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(headX - 14, headY - 7);
  ctx.lineTo(headX - 1, headY - 3);
  ctx.moveTo(headX + 18, headY - 7);
  ctx.lineTo(headX + 5, headY - 3);
  ctx.stroke();

  // Iconic HUGE Fluffy Black Beard!
  ctx.fillStyle = '#18181b';
  ctx.strokeStyle = '#09090b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(headX - 20, headY + 7);
  ctx.quadraticCurveTo(headX - 26, headY + 24, headX - 10, headY + 31);
  ctx.quadraticCurveTo(headX + 2, headY + 36, headX + 15, headY + 30);
  ctx.quadraticCurveTo(headX + 27, headY + 22, headX + 22, headY + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Roaring / shouting open mouth inside the beard!
  if (isRoar || isCharge || isHeavy) {
    drawRoundedBox(ctx, headX - 5, headY + 9, 15, 11, '#991b1b', '#1c120c');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(headX - 3, headY + 10, 11, 3);
  } else {
    // Fierce grinning mouth
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(headX - 4, headY + 10, 12, 4);
  }

  // Charge speed aura rim on frame 6
  if (isCharge) {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx + 12, footY - 40, 42, -0.8, 0.8);
    ctx.stroke();
  }
}

function buildBanditSplatFace(scene: Phaser.Scene): void {
  const size = 240;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const cx = size / 2;
  const cy = size / 2;

  // Soft translucent glass condensation / splat ring behind face
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4, 108, 94, 0, 0, Math.PI * 2);
  ctx.fill();

  // Squashed cute hands pressed flat against the glass on left & right!
  drawCircle(ctx, cx - 82, cy + 36, 22, '#f5cba7', '#2c1810');
  drawCircle(ctx, cx + 82, cy + 36, 22, '#f5cba7', '#2c1810');

  // Blue bandit hair & topknot
  drawCircle(ctx, cx, cy - 16, 76, '#2e231c', '#140e0a');
  drawCircle(ctx, cx, cy - 88, 22, '#2e231c', '#140e0a');

  // Wide squashed face pressed flat against the camera glass!
  ctx.fillStyle = '#f5cba7';
  ctx.strokeStyle = '#2c1810';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 12, 74, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Blue headband across forehead
  drawRoundedBox(ctx, cx - 72, cy - 52, 144, 24, '#1e3a5f', '#0f172a');
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(cx - 66, cy - 46, 132, 6);

  // Squashed rosy cheeks pressed wide
  ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
  ctx.beginPath();
  ctx.ellipse(cx - 46, cy + 26, 20, 14, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 46, cy + 26, 20, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // HUGE bulging terrified cartoon eyes!
  drawCircle(ctx, cx - 28, cy - 4, 22, '#ffffff', '#140e0a');
  drawCircle(ctx, cx + 28, cy - 4, 22, '#ffffff', '#140e0a');
  // Tiny shocked pupils (slightly cross-eyed for maximum comedy!)
  drawCircle(ctx, cx - 23, cy - 2, 7, '#0f172a', '#0f172a');
  drawCircle(ctx, cx + 23, cy - 2, 7, '#0f172a', '#0f172a');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 26, cy - 7, 5, 5);
  ctx.fillRect(cx + 20, cy - 7, 5, 5);

  // Flattened nose pressed against the glass
  ctx.fillStyle = '#e59866';
  ctx.strokeStyle = '#5c3317';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 18, 14, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Squashed wide screaming "O" mouth
  ctx.fillStyle = '#7f1d1d';
  ctx.strokeStyle = '#140e0a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 44, 24, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f87171';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 51, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sweat droplets flying off
  ctx.fillStyle = '#7dd3fc';
  ctx.beginPath();
  ctx.ellipse(cx - 78, cy - 38, 7, 11, -0.4, 0, Math.PI * 2);
  ctx.ellipse(cx + 80, cy - 32, 6, 10, 0.4, 0, Math.PI * 2);
  ctx.fill();

  scene.textures.addCanvas('bandit_splat_face', canvas);
}

function drawRoundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
