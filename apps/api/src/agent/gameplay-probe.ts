/** Trusted, test-only observer. The preview runtime, CSP and generated GameAPI stay unchanged.
 * This code is inserted AFTER validated source, inside the existing sandbox factory.
 * API descriptors/getters and all host budgets are preserved; generated code is never run in Node.
 */
export const GAMEPLAY_PROBE = `
const __probe = (() => {
  let host, observed, playerId = 0, ended = false, positions = [], births = [], removals = [], contacts = [];
  const copy = e => ({id:e.id,x:e.x,y:e.y,vx:e.vx,vy:e.vy,width:e.width,height:e.height,hp:e.hp,alive:e.alive});
  const bounded = (list, item) => { list.push(item); if (list.length > 500) list.shift(); };
  const wrap = api => {
    if (observed) return observed;
    host = api;
    const descriptors = Object.getOwnPropertyDescriptors(api);
    descriptors.spawn.value = (...args) => {
      const entity = api.spawn(...args), player = api.get(playerId);
      bounded(births, {...copy(entity),time:api.time,player:player ? copy(player) : null});
      return entity;
    };
    descriptors.setPlayer.value = entity => { playerId = entity.id; api.setPlayer(entity); };
    descriptors.remove.value = entity => { bounded(removals, {...copy(entity),time:api.time}); api.remove(entity); };
    descriptors.overlaps.value = (a,b) => {
      const hit = api.overlaps(a,b);
      if (hit) bounded(contacts, {a:a.id,b:b.id,time:api.time});
      return hit;
    };
    descriptors.win.value = () => { ended = true; api.win(); };
    descriptors.lose.value = () => { ended = true; api.lose(); };
    observed = Object.freeze(Object.defineProperties({}, descriptors));
    return observed;
  };
  Object.defineProperty(globalThis, '__agentGameplayProbe', {value:Object.freeze({
    read: () => ({time:host.time,ended,playerId,entities:host.entities.map(copy),births,removals,contacts}),
    position: values => { positions = values; }
  })});
  return {
    create: api => { ended=false; births=[]; removals=[]; contacts=[]; positions=[]; create(wrap(api)); },
    update: (api,dt) => {
      for (const position of positions) { const entity=api.get(position.id); if (entity) { entity.x=position.x; entity.y=position.y; entity.vx=0; entity.vy=0; } }
      update(wrap(api),dt);
    }
  };
})();
return __probe;`;

export interface ProbeEntity { id: number; x: number; y: number; vx?: number; vy?: number; width: number; height: number; hp: number; alive: boolean }
export interface ProbeBirth extends ProbeEntity { time: number; player: ProbeEntity | null }
export interface GameplaySnapshot {
  time: number; ended?: boolean; playerId: number; entities: ProbeEntity[]; births: ProbeBirth[];
  removals: Array<ProbeEntity & { time: number }>;
  contacts: Array<{ a: number; b: number; time: number }>;
}
