const paths={
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 2v3l-5 4-3-1-3 1-5-4v-3l-2-2 2-5 3-1z"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',back:'<path d="m14 5-7 7 7 7"/>',
 person:'<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
 people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
 graph:'<circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10.5 8-4 7m7-7 4 7M8 18h8"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
 book:'<path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16"/>',
 link:'<path d="m9 15 6-6m-7 8-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
 check:'<path d="m5 12 4 4L19 6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 left:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',right:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
 trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
 undo:'<path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14"/>',
 fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
 minus:'<path d="M5 12h14"/>',target:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
 tag:'<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7" cy="7" r="1"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
}
export const icon=(name,size=18)=>`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.person}</svg>`
