import Phaser from 'phaser';

/**
 * Generates Step 6 colorful 16-bit chibi pixel-art spritesheets:
 *  - 'boss_chief_sheet' (8 frames, 192x192): 산적 두목 (Bandit Chief)
 *  - 'elite_bandit_sheet' (6 frames, 160x160): 정예 산적 (Elite Bandit)
 *  - 'treasure_chest_icon' (48x48): Golden treasure chest pickup
 *  - 'wind_blade_projectile' (44x28): Guan Yu Tier-4 green wind crescent
 */
export function generateStep6Sprites(scene: Phaser.Scene): void {
  generateBossChiefSheet(scene);
  generateEliteBanditSheet(scene);
  generateTreasureChestTexture(scene);
  generateWindBladeTexture(scene);
}

function generateBossChiefSheet(scene: Phaser.Scene): void {
  if (scene.textures.exists('boss_chief_sheet')) return;

  const fw = 192;
  const fh = 192;
  const frames = 8;
  // 0: IDLE, 1: WALK_A, 2: WALK_B, 3: WINDUP_OVERHEAD, 4: SLAM_ACTIVE, 5: RUSH, 6: ROAR/ENRAGED, 7: STAGGER/KO
  const canvasTex = scene.textures.createCanvas('boss_chief_sheet', fw * frames, fh);
  if (!canvasTex) return;
  const ctx = canvasTex.getContext();
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < frames; i++) {
    const ox = i * fw;
    ctx.save();
    ctx.translate(ox, 0);
    drawBanditChiefFrame(ctx, i);
    ctx.restore();
  }

  for (let i = 0; i < frames; i++) {
    canvasTex.add(i, 0, i * fw, 0, fw, fh);
  }
  canvasTex.refresh();
}

function drawBanditChiefFrame(ctx: CanvasRenderingContext2D, frame: number): void {
  const cx = 96;
  const footY = 176;
  const isWalkA = frame === 1;
  const isWalkB = frame === 2;
  const isWindup = frame === 3;
  const isSlam = frame === 4;
  const isRush = frame === 5;
  const isRoar = frame === 6;
  const isKo = frame === 7;

  const bob = isWalkA ? -5 : isWalkB ? 2 : isRoar ? -4 : isSlam ? 6 : 0;
  const leanX = isRush ? 14 : isSlam ? 10 : isWindup ? -8 : 0;

  if (isKo) {
    // Comedic flat-on-back KO pose with dizzy stars
    ctx.save();
    ctx.translate(cx, footY - 26);
    ctx.rotate(-0.18);
    // Body lying down
    ctx.fillStyle = '#1c120c';
    ctx.fillRect(-58, -22, 116, 44);
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(-52, -16, 62, 32);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-46, -10, 50, 10);
    // Oversized head
    ctx.fillStyle = '#fdba74';
    ctx.beginPath();
    ctx.arc(32, -4, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c120c';
    ctx.lineWidth = 4;
    ctx.stroke();
    // Dizzy X eyes
    ctx.strokeStyle = '#1c120c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(22, -12);
    ctx.lineTo(30, -4);
    ctx.moveTo(30, -12);
    ctx.lineTo(22, -4);
    ctx.moveTo(36, -12);
    ctx.lineTo(44, -4);
    ctx.moveTo(44, -12);
    ctx.lineTo(36, -4);
    ctx.stroke();
    // Dizzy stars
    ctx.fillStyle = '#fde047';
    ctx.fillRect(20, -38, 8, 8);
    ctx.fillRect(42, -34, 7, 7);
    ctx.restore();
    return;
  }

  // Legs
  const leftLegX = cx - 22 + (isWalkA ? -8 : isWalkB ? 8 : 0);
  const rightLegX = cx + 12 + (isWalkA ? 8 : isWalkB ? -8 : 0);
  ctx.fillStyle = '#1c120c';
  ctx.fillRect(leftLegX - 10, footY - 30, 24, 30);
  ctx.fillRect(rightLegX - 10, footY - 30, 24, 30);
  ctx.fillStyle = '#451a03';
  ctx.fillRect(leftLegX - 6, footY - 26, 16, 22);
  ctx.fillRect(rightLegX - 6, footY - 26, 16, 22);

  // Muscular torso with crimson/gold spiked bandit armor
  const bodyX = cx + leanX;
  const bodyY = footY - 86 + bob;
  ctx.fillStyle = '#1c120c';
  ctx.beginPath();
  ctx.roundRect(bodyX - 44, bodyY, 88, 62, 16);
  ctx.fill();

  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.roundRect(bodyX - 38, bodyY + 5, 76, 52, 12);
  ctx.fill();

  // Ornate gold chest plate & belt
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(bodyX - 34, bodyY + 38, 68, 12);
  ctx.fillStyle = '#fde047';
  ctx.fillRect(bodyX - 10, bodyY + 35, 20, 18);

  // Spiked pauldrons
  ctx.fillStyle = '#292524';
  ctx.beginPath();
  ctx.arc(bodyX - 40, bodyY + 14, 16, 0, Math.PI * 2);
  ctx.arc(bodyX + 40, bodyY + 14, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(bodyX - 52, bodyY + 4);
  ctx.lineTo(bodyX - 62, bodyY - 8);
  ctx.lineTo(bodyX - 42, bodyY - 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bodyX + 52, bodyY + 4);
  ctx.lineTo(bodyX + 62, bodyY - 8);
  ctx.lineTo(bodyX + 42, bodyY - 2);
  ctx.fill();

  // Oversized chibi head
  const headX = bodyX;
  const headY = bodyY - 26;
  ctx.fillStyle = '#fdba74';
  ctx.beginPath();
  ctx.arc(headX, headY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1c120c';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Thick black beard & wild sideburns
  ctx.fillStyle = '#1c120c';
  ctx.beginPath();
  ctx.arc(headX, headY + 12, 28, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.fill();

  // Red bandit bandana + gold boss crest
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(headX - 33, headY - 28, 66, 15);
  ctx.strokeStyle = '#1c120c';
  ctx.lineWidth = 3;
  ctx.strokeRect(headX - 33, headY - 28, 66, 15);
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(headX, headY - 21, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Fierce/funny eyebrows & eyes
  ctx.fillStyle = '#1c120c';
  ctx.beginPath();
  ctx.moveTo(headX - 20, headY - 12);
  ctx.lineTo(headX - 4, headY - 5);
  ctx.lineTo(headX - 6, headY - 1);
  ctx.lineTo(headX - 22, headY - 7);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(headX + 20, headY - 12);
  ctx.lineTo(headX + 4, headY - 5);
  ctx.lineTo(headX + 6, headY - 1);
  ctx.lineTo(headX + 22, headY - 7);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(headX - 18, headY - 6, 10, 8);
  ctx.fillRect(headX + 8, headY - 6, 10, 8);
  ctx.fillStyle = isRoar ? '#ef4444' : '#1c120c';
  ctx.fillRect(headX - 13, headY - 4, 5, 5);
  ctx.fillRect(headX + 10, headY - 4, 5, 5);

  // Shouting mouth
  ctx.fillStyle = isRoar || isSlam ? '#7f1d1d' : '#450a0a';
  ctx.beginPath();
  ctx.ellipse(headX, headY + 13, isRoar ? 14 : 10, isRoar ? 10 : 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(headX - 8, headY + 8, 16, 4);

  // Giant studded wooden club
  ctx.save();
  if (isWindup) {
    ctx.translate(bodyX - 22, bodyY - 20);
    ctx.rotate(-2.1);
  } else if (isSlam) {
    ctx.translate(bodyX + 42, bodyY + 34);
    ctx.rotate(0.55);
  } else if (isRush) {
    ctx.translate(bodyX + 38, bodyY + 18);
    ctx.rotate(0.15);
  } else if (isRoar) {
    ctx.translate(bodyX + 44, bodyY - 18);
    ctx.rotate(-0.9);
  } else {
    ctx.translate(bodyX + 42, bodyY + 12);
    ctx.rotate(-0.35);
  }

  // Club handle & heavy spiked head
  ctx.fillStyle = '#1c120c';
  ctx.fillRect(-8, -8, 72, 16);
  ctx.fillStyle = '#92400e';
  ctx.fillRect(-4, -5, 64, 10);
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.roundRect(30, -18, 46, 36, 10);
  ctx.fill();
  ctx.strokeStyle = '#1c120c';
  ctx.lineWidth = 4;
  ctx.stroke();
  // Iron studs
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(38, -12, 7, 7);
  ctx.fillRect(54, -12, 7, 7);
  ctx.fillRect(46, 2, 7, 7);
  ctx.fillRect(62, 2, 7, 7);
  ctx.restore();
}

function generateEliteBanditSheet(scene: Phaser.Scene): void {
  if (scene.textures.exists('elite_bandit_sheet')) return;

  const fw = 160;
  const fh = 160;
  const frames = 6;
  // 0: IDLE, 1: WALK_A, 2: WALK_B, 3: WINDUP, 4: HEAVY_SLASH, 5: HURT/KNOCKDOWN
  const canvasTex = scene.textures.createCanvas('elite_bandit_sheet', fw * frames, fh);
  if (!canvasTex) return;
  const ctx = canvasTex.getContext();
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < frames; i++) {
    ctx.save();
    ctx.translate(i * fw, 0);
    drawEliteBanditFrame(ctx, i);
    ctx.restore();
  }
  for (let i = 0; i < frames; i++) {
    canvasTex.add(i, 0, i * fw, 0, fw, fh);
  }
  canvasTex.refresh();
}

function drawEliteBanditFrame(ctx: CanvasRenderingContext2D, frame: number): void {
  const cx = 80;
  const footY = 146;
  const bob = frame === 1 ? -4 : frame === 2 ? 2 : frame === 4 ? 4 : 0;

  // Boots
  ctx.fillStyle = '#18181b';
  ctx.fillRect(cx - 20 + (frame === 1 ? -5 : 0), footY - 22, 16, 22);
  ctx.fillRect(cx + 4 + (frame === 2 ? 5 : 0), footY - 22, 16, 22);

  // Dark steel armor torso
  const by = footY - 68 + bob;
  ctx.fillStyle = '#18181b';
  ctx.beginPath();
  ctx.roundRect(cx - 32, by, 64, 48, 12);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.roundRect(cx - 27, by + 4, 54, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(cx - 26, by + 26, 52, 8);

  // Chibi head
  const hy = by - 20;
  ctx.fillStyle = '#fed7aa';
  ctx.beginPath();
  ctx.arc(cx, hy, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Red elite headband with trailing knot
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(cx - 25, hy - 18, 50, 10);
  ctx.fillRect(cx - 35, hy - 14, 12, 6);
  ctx.fillRect(cx - 38, hy - 9, 10, 5);

  // Eyes
  ctx.fillStyle = '#18181b';
  ctx.fillRect(cx - 12, hy - 4, 7, 6);
  ctx.fillRect(cx + 5, hy - 4, 7, 6);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(cx - 10, hy - 2, 3, 3);
  ctx.fillRect(cx + 7, hy - 2, 3, 3);

  // Heavy broadsword
  ctx.save();
  if (frame === 3) {
    ctx.translate(cx - 14, by - 14);
    ctx.rotate(-2.0);
  } else if (frame === 4) {
    ctx.translate(cx + 32, by + 22);
    ctx.rotate(0.45);
  } else {
    ctx.translate(cx + 28, by + 10);
    ctx.rotate(-0.45);
  }
  ctx.fillStyle = '#18181b';
  ctx.fillRect(-4, -7, 56, 14);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(8, -5, 42, 10);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(4, -9, 6, 18);
  ctx.restore();
}

function generateTreasureChestTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('treasure_chest_icon')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Outer aura
  g.fillStyle(0xfef08a, 0.35);
  g.fillCircle(24, 24, 22);
  // Chest box
  g.fillStyle(0x1c120c, 1);
  g.fillRoundedRect(6, 12, 36, 26, 5);
  g.fillStyle(0xb91c1c, 1);
  g.fillRoundedRect(9, 15, 30, 20, 3);
  // Gold trim & clasp
  g.fillStyle(0xfacc15, 1);
  g.fillRect(9, 22, 30, 4);
  g.fillRect(20, 19, 8, 10);
  g.fillStyle(0xfef08a, 1);
  g.fillRect(22, 21, 4, 6);
  g.generateTexture('treasure_chest_icon', 48, 48);
  g.destroy();
}

function generateWindBladeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('wind_blade_projectile')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x22c55e, 0.9);
  g.fillEllipse(24, 14, 34, 24);
  g.fillStyle(0x86efac, 0.95);
  g.fillEllipse(28, 14, 24, 16);
  g.fillStyle(0xffffff, 0.95);
  g.fillEllipse(32, 14, 12, 8);
  g.generateTexture('wind_blade_projectile', 44, 28);
  g.destroy();
}
