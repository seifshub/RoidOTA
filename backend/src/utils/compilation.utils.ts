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
    const defineRegex = /#define\s+(\w+)\s+(.*?)$/gm;
    const defines: Record<string, string> = {};
    let match;

    while ((match = defineRegex.exec(code)) !== null) {
      defines[match[1]] = match[2].trim();
    }

    return defines;
  }

  static validateArduinoCode(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for basic Arduino functions
    if (!code.includes('void setup()') && !code.includes('void setup(')) {
      errors.push('Missing setup() function');
    }

    if (!code.includes('void loop()') && !code.includes('void loop(')) {
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
    const match = code.match(/void\s+setup\s*\(\s*\)\s*\{([\s\S]*?)\}/);
    return match ? match[1].trim() : '';
  }

  static extractLoopBody(code: string): string {
    const match = code.match(/void\s+loop\s*\(\s*\)\s*\{([\s\S]*?)\}/);
    return match ? match[1].trim() : '';
  }

  static extractExtraFunctions(code: string): string {
    return code
      .replace(/void\s+setup\s*\(\s*\)\s*\{[\s\S]*?\}/, '')
      .replace(/void\s+loop\s*\(\s*\)\s*\{[\s\S]*?\}/, '')
      .trim();
  }

  static sanitizeUserCode(code: string): string {
    // Remove any existing main MQTT handling to prevent conflicts
    const sanitized = code
      .replace(/void\s+callback\s*\([^)]*\)\s*\{[^}]*\}/g, '')
      .replace(/mqttClient\.(setCallback|setServer|connect)\([^)]*\);?/g, '')
      .replace(/#include\s*[<"]PubSubClient\.h[>"]/, '')
      .replace(/#include\s*[<"]ArduinoJson\.h[>"]/, '');
    
    return sanitized.trim();
  }

  static extractMqttRequirements(code: string): {
    needsMqtt: boolean;
    needsJson: boolean;
    customTopics: string[];
  } {
    const needsMqtt = code.includes('mqttClient') || code.includes('MQTT');
    const needsJson = code.includes('JsonDocument') || code.includes('json');
    
    // Extract custom topic definitions
    const topicRegex = /#define\s+(\w*TOPIC\w*)\s+"([^"]+)"/g;
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