import { BASELINE_TASK_SET } from "../evals/baseline-task-set";
import { scoreBaselineResponses } from "../evals/scoring";

describe("baseline eval scoring", () => {
  it("scores perfect responses at 100%", () => {
    const responses: Record<string, string> = {};
    for (const task of BASELINE_TASK_SET) {
      responses[task.id] = task.requiredKeywords.join(" ");
    }

    const report = scoreBaselineResponses(BASELINE_TASK_SET, responses);
    expect(report.normalizedScore).toBe(1);
    expect(report.totalScore).toBe(report.maxScore);
  });

  it("scores missing-keyword responses below 100%", () => {
    const responses: Record<string, string> = {};
    for (const task of BASELINE_TASK_SET) {
      responses[task.id] = task.requiredKeywords.slice(0, 1).join(" ");
    }

    const report = scoreBaselineResponses(BASELINE_TASK_SET, responses);
    expect(report.normalizedScore).toBeLessThan(1);
    expect(report.tasks.some((task) => task.missingKeywords.length > 0)).toBe(
      true
    );
  });
});

