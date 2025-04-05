export const clamp = (num: number, min: number, max: number) => (Math.min(max, Math.max(min, num)));
export const isBetween = (num: number, min: number, max: number) => (num >= min && num <= max);
export const round = (num: number, decimals: number = 0) => Math.round(num * 10 ** decimals) / 10 ** decimals;
export const lerp = (start: number, end: number, interpolationRatio: number) => {
  return (1 - interpolationRatio) * start + interpolationRatio * end;
};

// Fractional values cause blurry text & canvas. Round to even to keep whole numbers while centering
export function roundToNearestEven(value: number) {
  return Math.round(value / 2) * 2;
}

/**
 * Calculator utility for evaluating mathematical expressions
 */
export class ExpressionCalculator {
  /**
   * Evaluates a mathematical expression string
   * @param expr Expression to evaluate (e.g. "12 * 2 + (3.14152 * 1) + 100 / 4")
   * @returns Result of the calculation
   */
  static evaluate(expr: string): number {
    // Clean the expression by removing spaces and replacing ^ with **
    const sanitizedExpr = expr.replace(/\s/g, '')
      // Convert Chinese parentheses to English ones
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      // Convert Chinese decimal point to English one
      .replace(/。/g, '.')
      .replace(/\^/g, '**');
    return this.evaluateExpression(sanitizedExpr);
  }

  /**
   * Evaluates multiple expressions (one per line) and returns the results
   * @param expressions Multiple expressions separated by newlines
   * @returns Array of results for each valid expression
   */
  static evaluateMultiple(expressions: string): { expression: string; result: string; isError: boolean }[] {
    const lines = expressions.split('\n');
    const results: { expression: string; result: string; isError: boolean }[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Check if this is a math expression (contains only numbers, operators, parentheses, including Chinese ones)
      if (/^[\d\s+\-*/().,^%（）。]+$/.test(trimmedLine)) {
        try {
          const result = this.evaluate(trimmedLine);

          // Format the resul
          let formattedResult: string;
          if (!Number.isFinite(result)) {
            formattedResult = '错误: 结果无效';
          } else if (Math.abs(result) < 1e-10) {
            formattedResult = '0'; // Handle near-zero floating point issues
          } else {
            // Format to remove trailing zeros
            formattedResult = result.toFixed(10).replace(/\.?0+$/, '');
          }

          results.push({
            expression: trimmedLine,
            result: formattedResult,
            isError: false,
          });
        } catch (error: any) {
          results.push({
            expression: trimmedLine,
            result: error.message || '无法计算',
            isError: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Format calculation results into a readable string
   * @param results Array of calculation results
   * @returns Formatted string with all results
   */
  static formatResults(results: { expression: string; result: string; isError: boolean }[]): string {
    if (results.length === 0) {
      return '无法识别算术表达式，请确保表达式格式正确';
    }

    const formattedLines = results.map(
      ({ expression, result, isError }) => `${expression} = ${isError ? '错误: ' : ''}${result}`,
    );

    return `计算结果:\n${formattedLines.join('\n')}`;
  }

  // Private helper methods
  private static evaluateExpression(expr: string): number {
    // Helper to check if a character is an operator
    const isOperator = (c: string): boolean => ['+', '-', '*', '/', '%', '(', ')'].includes(c);

    // Helper to get operator precedence
    const precedence = (op: string): number => {
      if (op === '+' || op === '-') return 1;
      if (op === '*' || op === '/' || op === '%') return 2;
      return 0;
    };

    // Helper to apply operator
    const applyOperator = (b: number, a: number, op: string): number => {
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new Error('除数不能为零');
          return a / b;
        case '%': return a % b;
        default: throw new Error(`不支持的运算符: ${op}`);
      }
    };

    const values: number[] = [];
    const operators: string[] = [];

    // Process each character in the expression
    let i = 0;
    while (i < expr.length) {
      // If current character is a digit or decimal point, read the full number
      if ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.') {
        let numStr = '';

        // Read the entire number including decimals
        while (i < expr.length
               && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
          numStr += expr[i++];
        }
        values.push(parseFloat(numStr));
        continue;
      }

      // If current token is an opening bracket, push to operators stack
      if (expr[i] === '(') {
        operators.push(expr[i]);
      } else if (expr[i] === ')') { // If current token is a closing bracket, solve the bracket expression
        while (operators.length > 0 && operators[operators.length - 1] !== '(') {
          const op = operators.pop()!;
          const b = values.pop()!;
          const a = values.pop()!;
          values.push(applyOperator(b, a, op));
        }

        // Remove the opening bracke
        if (operators.length > 0) operators.pop();
      } else if (isOperator(expr[i])) { // If current token is an operator
        // While top of operators has higher precedence, apply i
        while (operators.length > 0
               && precedence(operators[operators.length - 1]) >= precedence(expr[i])) {
          const op = operators.pop()!;
          if (op === '(' || op === ')') break;
          const b = values.pop()!;
          const a = values.pop()!;
          values.push(applyOperator(b, a, op));
        }

        // Push current operator to stack
        operators.push(expr[i]);
      } else {
        throw new Error(`无效字符: ${expr[i]}`);
      }

      i++;
    }

    // Process any remaining operators
    while (operators.length > 0) {
      const op = operators.pop()!;
      if (op === '(' || op === ')') {
        throw new Error('括号不匹配');
      }
      const b = values.pop()!;
      const a = values.pop()!;
      values.push(applyOperator(b, a, op));
    }

    // The final value should be the resul
    if (values.length !== 1) {
      throw new Error('表达式格式错误');
    }
    return values[0];
  }
}
