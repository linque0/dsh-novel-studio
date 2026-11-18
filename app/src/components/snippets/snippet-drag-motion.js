const LIFT = 1.025
const GHOST_GUTTER = 26
const EASING = 'cubic-bezier(.2,.75,.24,1)'
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const cardKey = (group, id) => JSON.stringify([group, id])

function boardCards(board) {
  const cards = new Map()
  const clip = board.getBoundingClientRect()
  for (const element of board.querySelectorAll('.snip-lane .snip-note')) {
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.right <= clip.left || rect.left >= clip.right ||
        rect.bottom <= clip.top || rect.top >= clip.bottom) continue
    const id = element.dataset.id
    const group = element.closest('.snip-lane').dataset.group
    cards.set(cardKey(group, id), { id, element, rect })
  }
  return cards
}

function makeGhost(card, bounds) {
  const ghost = document.createElement('div')
  ghost.className = 'snip-shell snip-drag-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  const lane = document.createElement('div')
  lane.className = 'snip-lane'
  lane.style.width = bounds.width + 'px'
  const clone = card.cloneNode(true)
  const style = getComputedStyle(card)
  clone.style.backgroundColor = style.backgroundColor
  ghost.style.setProperty('--snip-card-scale', style.getPropertyValue('--snip-card-scale') || '1')
  ghost.style.setProperty('--snip-card-lines', style.getPropertyValue('--snip-card-lines') || '8')
  ghost.style.width = bounds.width * LIFT + GHOST_GUTTER * 2 + 'px'
  ghost.style.height = bounds.height * LIFT + GHOST_GUTTER * 2 + 'px'
  ghost.style.padding = GHOST_GUTTER + 'px'
  ghost.style.transformOrigin = GHOST_GUTTER + 'px ' + GHOST_GUTTER + 'px'
  lane.style.transform = 'scale(' + LIFT + ')'
  lane.append(clone)
  ghost.append(lane)
  document.body.append(ghost)
  return ghost
}

/** Own the native drag preview until drop, then keep it alive until the save and landing finish. */
export function createSnippetDragMotion() {
  let pickup = null
  let landing = null

  function endDrag() {
    pickup?.ghost.remove()
    pickup = null
  }

  function cancelLanding(token = landing) {
    if (!token || landing !== token) return
    landing = null
    token.source.removeAttribute('data-snip-pending')
    token.destination?.removeAttribute('data-snip-landing')
    token.ghost.remove()
    for (const animation of token.animations) animation.cancel()
  }

  function cancel() {
    endDrag()
    cancelLanding()
  }

  function start(card, event) {
    cancel()
    if (!card) return
    const bounds = card.getBoundingClientRect()
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    if (reducedMotion() || typeof card.animate !== 'function' || !bounds.width || !bounds.height) {
      event.dataTransfer.setDragImage(card, x, y)
      return
    }
    const ghost = makeGhost(card, bounds)
    pickup = { ghost, source: card, width: bounds.width * LIFT, height: bounds.height * LIFT, x: x * LIFT, y: y * LIFT }
    event.dataTransfer.setDragImage(ghost, pickup.x + GHOST_GUTTER, pickup.y + GHOST_GUTTER)
  }

  function hold(event, board) {
    if (!pickup || !board || reducedMotion()) return null
    const left = event.clientX - pickup.x
    const top = event.clientY - pickup.y
    pickup.ghost.style.left = left - GHOST_GUTTER + 'px'
    pickup.ghost.style.top = top - GHOST_GUTTER + 'px'
    pickup.source.setAttribute('data-snip-pending', '')
    landing = {
      ...pickup, left, top, previous: boardCards(board), animations: [],
      scrollLeft: board.scrollLeft, scrollTop: board.scrollTop
    }
    pickup = null
    return landing
  }

  function land(token, board, { id, group, sameGroup, compact }) {
    if (!token || token !== landing) return
    if (!board || reducedMotion()) {
      cancelLanding(token)
      return
    }
    const cards = boardCards(board)
    const destination = cards.get(cardKey(group, id))
    const duration = sameGroup ? 180 : 230
    const animate = (element, frames, fill = 'none') => {
      token.animations.push(element.animate(frames, { duration, easing: EASING, fill }))
    }

    for (const [key, { id: cardId, element, rect }] of cards) {
      const previous = token.previous.get(key)?.rect
      if (!previous || cardId === id) continue
      // Account for scroll clamping when a temporary or empty lane disappears.
      const dx = previous.left - rect.left - (board.scrollLeft - token.scrollLeft)
      const dy = previous.top - rect.top - (board.scrollTop - token.scrollTop)
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        animate(element, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }])
      }
    }

    if (!destination || compact && !sameGroup) {
      token.ghost.remove()
      if (destination) {
        animate(destination.element, [{ opacity: .65, transform: 'scale(.975)' }, { opacity: 1, transform: 'none' }])
      }
    } else {
      token.destination = destination.element
      token.destination.setAttribute('data-snip-landing', '')
      const { left, top, width, height } = destination.rect
      animate(token.ghost, [
        { transform: 'none' },
        { transform: `translate(${left - token.left}px, ${top - token.top}px) scale(${width / token.width}, ${height / token.height})` }
      ], 'both')
    }

    return Promise.allSettled(token.animations.map(animation => animation.finished)).then(() => cancelLanding(token))
  }

  return { start, hold, endDrag, land, cancelLanding, cancel }
}
