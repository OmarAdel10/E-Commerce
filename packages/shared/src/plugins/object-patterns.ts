import { compileCustomFieldPattern } from "../custom-field-pattern";
import { customFieldSupportsRegex, type CustomFieldType } from "../custom-fields";
import type { PluginManifest } from "./manifest";

/** Strict build/install boundary; stored declarations remain readable for repair. */
export function pluginObjectPatternIssues(manifest: Pick<PluginManifest, "objects">): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  for (const [object, declaration] of Object.entries(manifest.objects)) {
    for (const [index, field] of declaration.fields.entries()) {
      const pattern = field.validations.regex;
      if (pattern === undefined || pattern === null || pattern.trim() === "") continue;
      if (!customFieldSupportsRegex(field.type as CustomFieldType) || compileCustomFieldPattern(pattern) === null) {
        issues.push({ path: `objects.${object}.fields.${index}.validations.regex`, message: "Use a supported text pattern without lookaround or backreferences." });
        if (issues.length === 20) return issues;
      }
    }
  }
  return issues;
}
