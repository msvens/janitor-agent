import { sanitizeSchemaForGemini } from "../backends/gemini";
import { Type } from "@google/genai";

describe("sanitizeSchemaForGemini", () => {
  it("strips $schema, $ref, definitions, additionalProperties", () => {
    const input = {
      $schema: "http://json-schema.org/draft-07",
      $ref: "#/definitions/Foo",
      definitions: { Foo: {} },
      additionalProperties: false,
      type: "object",
      properties: { name: { type: "string" } },
    };
    const out = sanitizeSchemaForGemini(input);
    expect(out.$schema).toBeUndefined();
    expect(out.$ref).toBeUndefined();
    expect(out.definitions).toBeUndefined();
    expect(out.additionalProperties).toBeUndefined();
    expect(out.type).toBe(Type.OBJECT);
  });

  it("maps type strings to Gemini Type enum", () => {
    expect(sanitizeSchemaForGemini({ type: "string" }).type).toBe(Type.STRING);
    expect(sanitizeSchemaForGemini({ type: "integer" }).type).toBe(Type.INTEGER);
    expect(sanitizeSchemaForGemini({ type: "boolean" }).type).toBe(Type.BOOLEAN);
    expect(sanitizeSchemaForGemini({ type: "array" }).type).toBe(Type.ARRAY);
    expect(sanitizeSchemaForGemini({ type: "number" }).type).toBe(Type.NUMBER);
    expect(sanitizeSchemaForGemini({ type: "object" }).type).toBe(Type.OBJECT);
  });

  it("recurses into properties", () => {
    const input = {
      type: "object",
      properties: {
        path: { type: "string", additionalProperties: false },
        count: { type: "integer" },
      },
    };
    const out = sanitizeSchemaForGemini(input) as {
      type: Type;
      properties: Record<string, { type: Type; additionalProperties?: unknown }>;
    };
    expect(out.properties.path!.type).toBe(Type.STRING);
    expect(out.properties.path!.additionalProperties).toBeUndefined();
    expect(out.properties.count!.type).toBe(Type.INTEGER);
  });

  it("recurses into array items", () => {
    const input = {
      type: "array",
      items: { type: "string", $schema: "x" },
    };
    const out = sanitizeSchemaForGemini(input) as {
      type: Type;
      items: { type: Type; $schema?: unknown };
    };
    expect(out.items.type).toBe(Type.STRING);
    expect(out.items.$schema).toBeUndefined();
  });

  it("preserves other keys like description, required, enum", () => {
    const input = {
      type: "string",
      description: "The file path",
      enum: ["a", "b"],
    };
    const out = sanitizeSchemaForGemini(input);
    expect(out.description).toBe("The file path");
    expect(out.enum).toEqual(["a", "b"]);
  });
});
