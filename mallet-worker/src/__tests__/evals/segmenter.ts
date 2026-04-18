/**
 * Eval segmenter — re-export of the production segmenter at
 * `src/lib/segmenter.ts`. Both the authenticated editor pipeline and
 * the public `/api/public/analyze` endpoint segment prompts through
 * that module, so the eval must use the same code or the fixtures
 * measure the wrong thing.
 *
 * We keep `EvalSegment` and `segmentForEval` as named aliases so the
 * existing eval call sites don't need to change shape.
 */
export { hashSegment, type Segment as EvalSegment, segmentPrompt as segmentForEval } from '../../lib/segmenter'
