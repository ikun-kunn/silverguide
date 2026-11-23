import ts from 'typescript';

const sharedRules = [
  { label: 'Bearer 明文令牌', pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/ },
  { label: '疑似私密密钥', pattern: /\b(?:sk-|pat_|sat_|ghp_|gho_)[A-Za-z0-9_-]{20,}/i },
  { label: '疑似私钥内容', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
];
const frontendRules = [
  { label: 'Authorization 请求头出现在前端', pattern: /["']?Authorization["']?\s*:/ },
  { label: 'Cloud Agents 私有域名出现在前端', pattern: /api\.qoder\.com\.cn/ },
  { label: '服务端凭证变量名出现在前端', pattern: /QODER_ACCESS_TOKEN/ },
];

const secretName = /^(?:authorization|token|access_?token|api_?key|api_?secret|client_?secret|secret|password|pat|sat|private_?key|.+_(?:TOKEN|SECRET|PASSWORD|PAT|API_KEY|PRIVATE_KEY))$/i;
const placeholder = (value) => value.trim() === '' || /^<[^>]+>$/.test(value) || /^your[_-][\w-]+$/i.test(value);

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return '';
}

function staticString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left), right = staticString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

/** 仅检查静态赋值和静态回退值，不会错误地把服务端配置引用认作明文密钥。 */
function staticAlternatives(node) {
  const literal = staticString(node);
  if (literal !== undefined) return [literal];
  if (ts.isParenthesizedExpression(node)) return staticAlternatives(node.expression);
  if (ts.isConditionalExpression(node)) return [...staticAlternatives(node.whenTrue), ...staticAlternatives(node.whenFalse)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    return [...staticAlternatives(node.left), ...staticAlternatives(node.right)];
  }
  return [];
}

export function inspectSource(fileName, content, frontend) {
  const findings = [];
  const seen = new Set();
  function add(line, label) { const key = `${line}:${label}`; if (!seen.has(key)) { seen.add(key); findings.push({ line, label }); } }
  content.split(/\r?\n/).forEach((line, i) => {
    for (const rule of [...sharedRules, ...(frontend ? frontendRules : [])]) if (rule.pattern.test(line)) add(i + 1, rule.label);
  });
  if (frontend) return findings;

  // TS/JS 的结构化分析可识别静态凭证属性、变量和默认值，不误报合法动态 Authorization。
  if (/\.(?:[cm]?[jt]sx?|json)$/i.test(fileName)) {
    const tree = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    function inspectAssignment(nameNode, valueNode) {
      if (!nameNode || !valueNode || !secretName.test(propertyName(nameNode))) return;
      if (staticAlternatives(valueNode).some(value => !placeholder(value))) {
        add(tree.getLineAndCharacterOfPosition(valueNode.getStart(tree)).line + 1, '服务端凭证包含硬编码字面量');
      }
    }
    function visit(node) {
      if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) inspectAssignment(node.name, node.initializer);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) inspectAssignment(node.left, node.right);
      ts.forEachChild(node, visit);
    }
    visit(tree);
  } else if (/\.(?:ps1|sh|cmd|bat|ya?ml)$/i.test(fileName)) {
    content.split(/\r?\n/).forEach((line, i) => {
      const match = /^\s*(?:\$|export\s+|set\s+)?([\w]+)\s*[:=]\s*(['"])(.*?)\2\s*(?:#.*)?$/i.exec(line);
      if (match && secretName.test(match[1]) && !placeholder(match[3])) add(i + 1, '服务端脚本凭证包含硬编码字面量');
    });
  }
  return findings;
}
