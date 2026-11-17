export const DEFAULT_BIOGRAPHY_TITLE = '人物小传'

export function characterBiographies(character) {
  const extra = Array.isArray(character?.biographies) ? character.biographies : []
  return [
    { id: 'primary', title: String(character?.biographyTitle || DEFAULT_BIOGRAPHY_TITLE), content: String(character?.content ?? '') },
    ...extra.filter(item => item && typeof item === 'object').map((item, index) => ({
      id: String(item.id || 'legacy-' + index),
      title: String(item.title || '小传 ' + (index + 2)),
      content: String(item.content ?? '')
    }))
  ]
}

export function readCharacterBiographies(character) {
  return characterBiographies(character)
    .filter((item, index) => index || item.title !== DEFAULT_BIOGRAPHY_TITLE || item.content.trim())
    .map(item => ({ ...item, paragraphs: item.content.split(/\n{2,}/).map(p => p.trim()).filter(Boolean) }))
}

export function characterBiographyText(character) {
  return readCharacterBiographies(character)
    .map(item => [item.title === DEFAULT_BIOGRAPHY_TITLE ? '' : item.title, item.content].filter(Boolean).join('\n'))
    .join('\n\n')
}

export function createCharacterDraft(character) {
  return {
    name: character.name || '',
    aliases: character.aliases || '',
    role: character.role || '',
    tags: [...(character.tags || [])],
    fields: { ...character.fields },
    avatarAssetId: character.avatarAssetId ?? null,
    biographies: characterBiographies(character)
  }
}

function biographyFields(biographies) {
  const [first, ...rest] = biographies.map(({ id, title, content }, index) => ({
    id, title: title.trim() || (index ? '小传 ' + (index + 1) : DEFAULT_BIOGRAPHY_TITLE), content
  }))
  return {
    content: first?.content ?? '',
    biographyTitle: first?.title === DEFAULT_BIOGRAPHY_TITLE ? '' : first?.title ?? '',
    biographies: rest
  }
}

export function characterDraftPatch(original, draft) {
  const { biographies: originalBiographies, ...originalFields } = original
  const { biographies: draftBiographies, ...draftFields } = draft
  const before = { ...originalFields, ...biographyFields(originalBiographies) }
  const after = { ...draftFields, ...biographyFields(draftBiographies) }
  return Object.fromEntries(Object.entries(after)
    .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])))
}
