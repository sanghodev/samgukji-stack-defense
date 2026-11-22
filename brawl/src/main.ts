import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config/arenaConfig';
import { BootScene } from './scenes/BootScene';
import { BrawlScene } from './scenes/BrawlScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1612',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [BootScene, BrawlScene],
};

new Phaser.Game(config);
