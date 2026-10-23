// Replace-options decision used by every text-mutation path in the Language
// Editor (sidebar Accept, sidebar Edit, popover Replace via Enter / Replace
// button, and the popover's UPPERCASE/lowercase/Title Case buttons which
// feed into the same path).
//
// Branching on the editor's TC toggle is the single integration point for
// Track Changes behavior: when the toggle is ON every replacement records a
// del+ins pair the user can see as red strikethrough + green insertion;
// when OFF the behavior is a plain in-place swap. The `highlighted` action
// is a separate affordance that marks the span yellow without editing it.

export type ReplaceDecision = 'accepted' | 'edited' | 'highlighted'

export interface ReplaceOptions {
  asTrackChanges?: boolean
  highlightOnly?: boolean
}

export function replaceOptionsFor(
  decision: ReplaceDecision,
  trackChangesEnabled: boolean,
): ReplaceOptions {
  if (decision === 'highlighted') {
    return { highlightOnly: true }
  }
  return { asTrackChanges: trackChangesEnabled }
}
