/** Transitions operate on the finished composition, never on individual layers. */
export const sceneTransitionKinds = ['black', 'white', 'pink', 'blur', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'shutter-x', 'shutter-y'] as const;
export type SceneTransitionKind = typeof sceneTransitionKinds[number];
export interface SceneTransition { kind: SceneTransitionKind; duration: number; intensity: number }
export interface TimedSceneTransition extends SceneTransition { at: number }
export const transitionNames: Record<SceneTransitionKind, [string, string]> = {
  black: ['Dissolvenza al nero', 'Dip to black'], white: ['Dissolvenza al bianco', 'Dip to white'],
  pink: ['Dissolvenza Lonely', 'Lonely dip'], blur: ['Sfocatura morbida', 'Soft blur'],
  'zoom-in': ['Zoom avanti morbido', 'Soft zoom in'], 'zoom-out': ['Zoom indietro morbido', 'Soft zoom out'],
  'slide-left': ['Scorrimento a sinistra', 'Slide left'], 'slide-right': ['Scorrimento a destra', 'Slide right'],
  'shutter-x': ['Chiusura orizzontale', 'Horizontal shutter'], 'shutter-y': ['Chiusura verticale', 'Vertical shutter'],
};
export function sceneTransitionFrame(items: readonly TimedSceneTransition[], time: number) {
  const item = items.find(item => item.duration > 0 && Math.abs(time - item.at) < item.duration / 2);
  if (!item) return null;
  const phase = 1 - Math.abs(time - item.at) / (item.duration / 2);
  const strength = Math.max(0, Math.min(1, item.intensity));
  const progress = Math.pow(phase * phase * (3 - 2 * phase), 1.6 - strength);
  const direction = time < item.at ? -1 : 1;
  return {
    opacity: 1 - progress, background: item.kind === 'white' ? '#ffffff' : item.kind === 'pink' ? '#ed589c' : '#000000',
    scale: item.kind === 'zoom-in' ? 1 + progress * (.04 + strength * .16) : item.kind === 'zoom-out' ? 1 - progress * (.04 + strength * .16) : 1,
    x: item.kind === 'slide-left' ? direction * progress * (.03 + strength * .12) : item.kind === 'slide-right' ? -direction * progress * (.03 + strength * .12) : 0,
    blur: item.kind === 'blur' ? progress * (.002 + strength * .012) : 0,
    insetX: item.kind === 'shutter-x' ? progress / 2 : 0,
    insetY: item.kind === 'shutter-y' ? progress / 2 : 0,
  };
}
