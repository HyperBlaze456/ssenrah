import { BaselineEvalTask } from "./baseline-task-set";

export interface TaskScore {
  id: string;
  score: number;
  maxScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
}

export interface BaselineScoreReport {
  timestamp: string;
  totalScore: number;
  maxScore: number;
  normalizedScore: number;
  tasks: TaskScore[];
}

/**
 * Keyword-based deterministic baseline scoring.
 */
export function scoreBaselineResponses(
  tasks: BaselineEvalTask[],
  responses: Record<string, string>
): BaselineScoreReport {
  const taskScores: TaskScore[] = tasks.map((task) => {
    const response = (responses[task.id] ?? "").toLowerCase();
    const matchedKeywords = task.requiredKeywords.filter((keyword) =>
      response.includes(keyword.toLowerCase())
    );
    const missingKeywords = task.requiredKeywords.filter(
      (keyword) => !matchedKeywords.includes(keyword)
    );
    const ratio =
      task.requiredKeywords.length === 0
        ? 1
        : matchedKeywords.length / task.requiredKeywords.length;
    const score = ratio * task.weight;

    return {
      id: task.id,
      score,
      maxScore: task.weight,
      matchedKeywords,
      missingKeywords,
    };
  });

  const totalScore = taskScores.reduce((sum, task) => sum + task.score, 0);
  const maxScore = taskScores.reduce((sum, task) => sum + task.maxScore, 0);
  const normalizedScore = maxScore === 0 ? 0 : totalScore / maxScore;

  return {
    timestamp: new Date().toISOString(),
    totalScore,
    maxScore,
    normalizedScore,
    tasks: taskScores,
  };
}

