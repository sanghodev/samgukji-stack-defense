# Sprite Stack Assets (`public/assets/stacks/`)

MagicaVoxel 등에서 추출한 **수평 슬라이스 스트립(Horizontal Slice Strip) PNG**를 이 폴더에 배치합니다.

- 프레임 0 (가장 왼쪽) = 바닥층(bottom slice)
- 프레임 N-1 (가장 오른쪽) = 최상층(top slice)
- 캐릭터의 정면 방향은 `+X` (오른쪽) 기준입니다.

## 기대 파일 목록

| 파일명 | 프레임 크기 | 층수 | 용도 |
| --- | --- | --- | --- |
| `castle_gate_stack.png` | 64×64 | 24층 | 중앙 성채 & 성문 |
| `barricade_stack.png` | 32×32 | 10층 | 나무 방책/바리케이드 |
| `sakura_tree_stack.png` | 40×40 | 18층 | 벚꽃나무 |
| `zhaoyun_stack.png` | 24×24 | 14층 | 조운 (플레이어) |
| `bandit_stack.png` | 20×20 | 12층 | 산적 (적군) |

현재는 `src/scenes/BootScene.ts`가 동일한 규격의 프로시저럴 테스트 슬라이스를 자동 생성합니다.
PNG 파일을 넣은 뒤 `BootScene.ts`의 `USE_EXTERNAL_PNG` 항목을 `true`로 바꾸면 1줄로 즉시 교체됩니다.
