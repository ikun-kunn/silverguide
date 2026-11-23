import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreVisionCase, summarizeScores, iou } from '../../scripts/vision-eval-core.mjs';
const expected = { id: '01', category: '清晰目标', expected: 'target', targetLabel: '预约挂号', boundingBox: [0.1, 0.2, 0.9, 0.4] };
const result = { success: true, instruction: '点预约挂号按钮。', targetLabel: '预约挂号按钮', boundingBox: expected.boundingBox, confidence: 0.9, safetyWarning: null };

test('正确标签与 IoU=1 的区域通过', () => {
  const score = scoreVisionCase(expected, result);
  assert.ok(score.passed && score.labelCorrect && score.boxCorrect);
  assert.equal(iou(expected.boundingBox, expected.boundingBox), 1);
});
test('正确标签但误标另一个区域不通过', () => {
  const score = scoreVisionCase(expected, { ...result, boundingBox: [0.1, 0.5, 0.9, 0.6] });
  assert.ok(score.labelCorrect && !score.boxCorrect && score.falseAnnotation && !score.passed);
});
test('不确定与风险场景独立计分，服务失败不记为安全通过', () => {
  const unknown = { ...expected, expected: 'uncertain' };
  const risk = { ...expected, expected: 'warning' };
  assert.ok(scoreVisionCase(unknown, { ...result, boundingBox: null, confidence: null }).passed);
  assert.ok(!scoreVisionCase(unknown, null).passed);
  assert.ok(scoreVisionCase(risk, { ...result, boundingBox: null, safetyWarning: '请核对授权信息' }).passed);
  const summary = summarizeScores([scoreVisionCase(expected, result), scoreVisionCase(unknown, null)]);
  assert.equal(summary.targetLabelAccuracy, 1); assert.equal(summary.expectedAbstention, 0); assert.equal(summary.serviceFailures, 1);
});
