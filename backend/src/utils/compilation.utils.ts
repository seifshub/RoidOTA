export class CompilationUtils {
  static extractIncludes(code: string): string[] {
    const includeRegex = /#include\s*[<"](.*?)[>"]/g;
    const includes: string[] = [];
    let match;

    while ((match = includeRegex.exec(code)) !== null) {
      includes.push(match[1]);
    }

    return includes;
  }

  static extractDefines(code: string): Record<string, string> {
    const defineRegex = /#define\s+(\w+)(?:\s+(.*))?$/gm;
    const defines: Record<string, string> = {};
    let match;

    while ((match = defineRegex.exec(code)) !== null) {
      defines[match[1]] = match[2] ? match[2].trim() : '';
    }

    return defines;
  }

  static validateArduinoCode(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for basic Arduino functions - more flexible matching
    if (!/void\s+setup\s*\(\s*\)\s*\{/.test(code)) {
      errors.push('Missing setup() function');
    }

    if (!/void\s+loop\s*\(\s*\)\s*\{/.test(code)) {
      errors.push('Missing loop() function');
    }

    // Check for balanced braces
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;

    if (openBraces !== closeBraces) {
      errors.push('Unbalanced braces in code');
    }

    // Check for potentially dangerous functions
    const dangerousFunctions = ['system(', 'exec(', 'eval('];
    for (const dangerous of dangerousFunctions) {
      if (code.includes(dangerous)) {
        errors.push(`Potentially dangerous function detected: ${dangerous}`);
      }
    }

    // Validate MQTT usage patterns
    if (code.includes('mqttClient.') || code.includes('PubSubClient')) {
      // Check for proper MQTT usage
      if (!code.includes('mqttClient.connected()')) {
        errors.push('MQTT client usage detected but no connection check found');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  static generateBuildId(): string {
    return `build_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  static estimateCompilationTime(codeSize: number): number {
    // Rough estimation: 1 second per 1KB of code, minimum 10 seconds
    return Math.max(10, Math.ceil(codeSize / 1024));
  }

  static extractSetupBody(code: string): string {
    const setupMatch = code.match(/void\s+setup\s*\(\s*\)\s*\{/);
    if (!setupMatch) return '';

    const startIndex = setupMatch.index! + setupMatch[0].length;
    let braceCount = 1;
    let i = startIndex;

    while (i < code.length && braceCount > 0) {
      if (code[i] === '{') braceCount++;
      else if (code[i] === '}') braceCount--;
      i++;
    }

    return code.slice(startIndex, i - 1).trim();
  }

  static extractLoopBody(code: string): string {
    const loopMatch = code.match(/void\s+loop\s*\(\s*\)\s*\{/);
    if (!loopMatch) return '';

    const startIndex = loopMatch.index! + loopMatch[0].length;
    let braceCount = 1;
    let i = startIndex;

    while (i < code.length && braceCount > 0) {
      if (code[i] === '{') braceCount++;
      else if (code[i] === '}') braceCount--;
      i++;
    }

    return code.slice(startIndex, i - 1).trim();
  }

  static extractExtraFunctions(code: string): string {
    // Remove setup and loop functions more accurately
    let result = code;
    
    // Remove setup function
    const setupMatch = result.match(/void\s+setup\s*\(\s*\)\s*\{/);
    if (setupMatch) {
      const startIndex = setupMatch.index!;
      const braceStart = startIndex + setupMatch[0].length;
      let braceCount = 1;
      let i = braceStart;

      while (i < result.length && braceCount > 0) {
        if (result[i] === '{') braceCount++;
        else if (result[i] === '}') braceCount--;
        i++;
      }

      result = result.slice(0, startIndex) + result.slice(i);
    }

    // Remove loop function
    const loopMatch = result.match(/void\s+loop\s*\(\s*\)\s*\{/);
    if (loopMatch) {
      const startIndex = loopMatch.index!;
      const braceStart = startIndex + loopMatch[0].length;
      let braceCount = 1;
      let i = braceStart;

      while (i < result.length && braceCount > 0) {
        if (result[i] === '{') braceCount++;
        else if (result[i] === '}') braceCount--;
        i++;
      }

      result = result.slice(0, startIndex) + result.slice(i);
    }

    return result.trim();
  }

  static sanitizeUserCode(code: string): string {
    // Remove any existing main MQTT handling to prevent conflicts
    let sanitized = code;
    
    // Remove callback functions more carefully
    sanitized = sanitized.replace(/void\s+callback\s*\([^)]*\)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
    
    // Remove MQTT client method calls
    sanitized = sanitized.replace(/mqttClient\.(setCallback|setServer|connect)\s*\([^)]*\)\s*;?/g, '');
    
    // Remove includes
    sanitized = sanitized.replace(/#include\s*[<"]PubSubClient\.h[>"].*$/gm, '');
    sanitized = sanitized.replace(/#include\s*[<"]ArduinoJson\.h[>"].*$/gm, '');

    return sanitized.trim();
  }

  static extractMqttRequirements(code: string): {
    needsMqtt: boolean;
    needsJson: boolean;
    customTopics: string[];
  } {
    const needsMqtt = /mqttClient|MQTT|PubSubClient/i.test(code);
    const needsJson = /JsonDocument|ArduinoJson|json/i.test(code);

    // Extract custom topic definitions - more flexible pattern
    const topicRegex = /#define\s+(\w*[Tt][Oo][Pp][Ii][Cc]\w*)\s+"([^"]+)"/g;
    const customTopics: string[] = [];
    let match;

    while ((match = topicRegex.exec(code)) !== null) {
      customTopics.push(match[2]);
    }

    return {
      needsMqtt,
      needsJson,
      customTopics
    };
  }
}