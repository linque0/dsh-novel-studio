const LAYOUT_KEYS=['left','right','leftClosed','rightClosed']
const EMPTY_LAYOUT={left:0,right:0,leftClosed:false,rightClosed:false}
export function initWorkspace(prefs){prefs.view=prefs.view==='graph'?'graph':'profile';prefs.layouts||={};prefs.cameras||={};return prefs.view}
export function changeView(prefs,next){if(!['profile','graph'].includes(next)||prefs.view===next)return prefs.view;const previous=prefs.view;prefs.layouts[previous]=Object.fromEntries(LAYOUT_KEYS.map(k=>[k,prefs[k]??EMPTY_LAYOUT[k]]));Object.assign(prefs,EMPTY_LAYOUT,prefs.layouts[next]||{});prefs.view=next;return next}
export function rememberCamera(prefs,key,camera,stage){if(!stage.width||!stage.height||!Number.isFinite(camera.z)||camera.z<=0)return;prefs.cameras[key]={cx:(stage.width/2-camera.x)/camera.z,cy:(stage.height/2-camera.y)/camera.z,z:camera.z}}
export function cameraFor(prefs,key,stage){const c=prefs.cameras?.[key];if(!c||!stage.width||!stage.height||![c.cx,c.cy,c.z].every(Number.isFinite)||c.z<.24||c.z>2)return null;return{x:stage.width/2-c.cx*c.z,y:stage.height/2-c.cy*c.z,z:c.z}}
