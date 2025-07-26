import { snakeCase } from "lodash";
import { getBetweenBrackets } from "./helpers";
export default class ExampleGenerator {
  public schemas = {};
  private currentRoute: string = "";
  private currentMethod: string = "";
  
  constructor(schemas: any) {
    this.schemas = schemas;
  }
  
  setCurrentRoute(route: string) {
    this.currentRoute = route;
  }
  
  setCurrentMethod(method: string) {
    this.currentMethod = method.charAt(0).toUpperCase() + method.toLowerCase().slice(1);
  }
  
  getCustomSchemas() {
    return this.customSchemas || {};
  }
  
  private customSchemas = {};

  jsonToRef(json) {
    const jsonObjectIsArray = Array.isArray(json);
    let out = {};
    let outArr = [];
    for (let [k, v] of Object.entries(json)) {
      if (typeof v === "object") {
        if (!Array.isArray(v)) {
          v = this.jsonToRef(v);
        }
      }
      if (typeof v === "string") {
        v = this.parseRef(v, true);
      }

      if (jsonObjectIsArray) {
        outArr.push(v);
      } else {
        out[k] = v;
      }
    }
    return outArr.length > 0 ? outArr.flat() : out;
  }

  parseRef(line: string, exampleOnly = false) {
    let rawRef = line.substring(line.indexOf("<") + 1, line.lastIndexOf(">"));

    if (rawRef === "") {
      if (exampleOnly) {
        return line;
      }
      // No format valid, returning the line as text/plain
      return {
        content: {
          "text/plain": {
            example: line,
          },
        },
      };
    }

    let inc = getBetweenBrackets(line, "with");
    let exc = getBetweenBrackets(line, "exclude");
    let append = getBetweenBrackets(line, "append");
    let only = getBetweenBrackets(line, "only");
    const paginated = getBetweenBrackets(line, "paginated");
    const serializer = getBetweenBrackets(line, "serialized");

    // Support method syntax like .only(field1, field2)
    if (!only) {
      const onlyMatch = line.match(/\.only\(([^)]+)\)/);
      if (onlyMatch) {
        only = onlyMatch[1].replace(/\s/g, '').replace(/"/g, '').replace(/'/g, '');
      }
    }
    
    if (!exc) {
      const excludeMatch = line.match(/\.exclude\(([^)]+)\)/);
      if (excludeMatch) {
        exc = excludeMatch[1].replace(/\s/g, '').replace(/"/g, '').replace(/'/g, '');
      }
    }
    
    if (!inc) {
      const withMatch = line.match(/\.with\(([^)]+)\)/);
      if (withMatch) {
        inc = withMatch[1].replace(/\s/g, '').replace(/"/g, '').replace(/'/g, '');
      }
    }
    
    if (!append) {
      const appendMatch = line.match(/\.append\(([^)]+)\)/);
      if (appendMatch) {
        // For append, we need to keep the JSON format
        let appendContent = appendMatch[1];
        try {
          // Try to parse as valid JSON object content
          JSON.parse('{' + appendContent + '}');
          append = appendContent;
        } catch {
          // If not valid JSON, treat as simple key-value
          append = appendContent;
        }
      }
    }

    if (serializer) {
      // we override to be sure
      inc = "";
      exc = "";
      only = "";

      if (this.schemas[serializer].fields.pick) {
        only += this.schemas[serializer].fields.pick.join(",");
      }
      if (this.schemas[serializer].fields.omit) {
        exc += this.schemas[serializer].fields.omit.join(",");
      }
      if (this.schemas[serializer].relations) {
        // get relations names and add them to inc
        const relations = Object.keys(this.schemas[serializer].relations);
        inc = relations.join(",");

        // we need to add the relation name to only and also we add the relation fields we want to only
        // ex : comment,comment.id,comment.createdAt
        relations.forEach((relation) => {
          const relationFields = this.schemas[serializer].relations[
            relation
          ].map((field) => relation + "." + field);

          only += "," + relation + "," + relationFields.join(",");
        });
      }
    }

    let app = {};
    try {
      if (append) {
        app = JSON.parse("{" + append + "}");
      }
    } catch {}

    const cleanedRef = rawRef.replace("[]", "");

    let ex = {};
    try {
      ex = Object.assign(
        this.getSchemaExampleBasedOnAnnotation(cleanedRef, inc, exc, only),
        app
      );
    } catch (e) {
      console.error("Error", cleanedRef);
    }

    const { dataName, metaName } = this.getPaginatedData(line);

    const paginatedEx = {
      [dataName]: [ex],
      [metaName]: this.getSchemaExampleBasedOnAnnotation("PaginationMeta"),
    };

    const paginatedSchema = {
      type: "object",
      properties: {
        [dataName]: {
          type: "array",
          items: { $ref: "#/components/schemas/" + cleanedRef },
        },
        [metaName]: { $ref: "#/components/schemas/PaginationMeta" },
      },
    };

    const normalArraySchema = {
      type: "array",
      items: { $ref: "#/components/schemas/" + cleanedRef },
    };

    // Check if we need to use a custom schema name
    let schemaRef = cleanedRef;
    const hasFilters = inc || exc || only || serializer || append;
    
    if (hasFilters && this.currentRoute && !exampleOnly) {
      // Extract all meaningful segments from the route for naming
      const routeSegments = this.currentRoute.split('/').filter(segment => segment && !segment.startsWith(':'));
      
      // Convert segments to PascalCase and join them
      const routeNameParts = routeSegments.map(segment => 
        segment.charAt(0).toUpperCase() + segment.toLowerCase().slice(1)
      );
      const routeName = routeNameParts.join('');
      
      // Create custom schema name with HTTP method prefix
      const methodPrefix = this.currentMethod || 'Unknown';
      schemaRef = `${methodPrefix}${routeName}${cleanedRef}`;
      
      // Generate custom schema based on the original schema and filters
      if (this.schemas[cleanedRef]) {
        const customSchema = this.generateCustomSchema(cleanedRef, inc, exc, only, app);
        if (customSchema) {
          this.customSchemas[schemaRef] = customSchema;
        }
      }
    }

    if (rawRef.includes("[]")) {
      if (exampleOnly) {
        return paginated === "true" ? paginatedEx : [ex];
      }
      
      const arrayItemRef = hasFilters && this.currentRoute ? schemaRef : cleanedRef;
      const paginatedSchemaWithCustom = {
        type: "object",
        properties: {
          [dataName]: {
            type: "array",
            items: { $ref: "#/components/schemas/" + arrayItemRef },
          },
          [metaName]: { $ref: "#/components/schemas/PaginationMeta" },
        },
      };
      
      const normalArraySchemaWithCustom = {
        type: "array",
        items: { $ref: "#/components/schemas/" + arrayItemRef },
      };
      
      return {
        content: {
          "application/json": {
            schema: paginated === "true" ? paginatedSchemaWithCustom : normalArraySchemaWithCustom,
            example: paginated === "true" ? paginatedEx : [ex],
          },
        },
      };
    }
    
    if (exampleOnly) {
      return ex;
    }

    return {
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/" + schemaRef,
          },
          example: ex,
        },
      },
    };
  }

  exampleByValidatorRule(rule: string) {
    switch (rule) {
      case "email":
        return "user@example.com";
      default:
        return "Some string";
    }
  }

  getSchemaExampleBasedOnAnnotation(
    schema: string,
    inc = "",
    exc = "",
    onl = "",
    first = "",
    parent = "",
    deepRels = [""]
  ) {
    let props = {};
    if (!this.schemas[schema]) {
      return props;
    }
    if (this.schemas[schema].example) {
      return this.schemas[schema].example;
    }

    let properties = this.schemas[schema].properties;
    let include = inc.toString().split(",");
    let exclude = exc.toString().split(",");
    let only = onl.toString().split(",");
    only = only.length === 1 && only[0] === "" ? [] : only;

    if (typeof properties === "undefined") return null;

    // skip nested if not requested
    if (
      parent !== "" &&
      schema !== "" &&
      parent.includes(".") &&
      this.schemas[schema].description.includes("Model") &&
      !inc.includes("relations") &&
      !inc.includes(parent) &&
      !inc.includes(parent + ".relations") &&
      !inc.includes(first + ".relations")
    ) {
      return null;
    }

    deepRels.push(schema);

    for (const [key, value] of Object.entries(properties)) {
      let isArray = false;
      if (exclude.includes(key)) continue;
      if (exclude.includes(parent + "." + key)) continue;

      if (
        key === "password" &&
        !include.includes("password") &&
        !only.includes("password")
      )
        continue;
      if (
        key === "password_confirmation" &&
        !include.includes("password_confirmation") &&
        !only.includes("password_confirmation")
      )
        continue;
      if (
        (key === "created_at" ||
          key === "updated_at" ||
          key === "deleted_at") &&
        exc.includes("timestamps")
      )
        continue;

      let rel = "";
      let example = value["example"];

      if (parent === "" && only.length > 0 && !only.includes(key)) continue;

      // for relations we can select the fields we want with this syntax
      // ex : comment.id,comment.createdAt
      if (
        parent !== "" &&
        only.length > 0 &&
        !only.includes(parent + "." + key)
      )
        continue;

      if (typeof value["$ref"] !== "undefined") {
        rel = value["$ref"].replace("#/components/schemas/", "");
      }

      if (
        typeof value["items"] !== "undefined" &&
        typeof value["items"]["$ref"] !== "undefined"
      ) {
        rel = value["items"]["$ref"].replace("#/components/schemas/", "");
      }

      if (typeof value["items"] !== "undefined") {
        isArray = true;
        example = value["items"]["example"];
      }

      if (rel !== "") {
        // skip related models of main schema
        if (
          parent === "" &&
          typeof this.schemas[rel] !== "undefined" &&
          this.schemas[rel].description?.includes("Model") &&
          !include.includes("relations") &&
          !include.includes(key)
        ) {
          continue;
        }

        if (
          parent !== "" &&
          !include.includes(parent + ".relations") &&
          !include.includes(parent + "." + key)
        ) {
          continue;
        }

        if (
          typeof value["items"] !== "undefined" &&
          typeof value["items"]["$ref"] !== "undefined"
        ) {
          rel = value["items"]["$ref"].replace("#/components/schemas/", "");
        }
        if (rel == "") {
          return;
        }

        let propdata: any = "";

        // if (!deepRels.includes(rel)) {
        // deepRels.push(rel);
        propdata = this.getSchemaExampleBasedOnAnnotation(
          rel,
          inc,
          exc,
          onl,
          parent,
          parent === "" ? key : parent + "." + key,
          deepRels
        );

        if (propdata === null) {
          continue;
        }

        props[key] = isArray ? [propdata] : propdata;
      } else {
        props[key] = isArray ? [example] : example;
      }
    }

    return props;
  }

  exampleByType(type) {
    switch (type) {
      case "string":
        return this.exampleByField("title");
      case "number":
        return Math.floor(Math.random() * 1000);
      case "integer":
        return Math.floor(Math.random() * 1000);
      case "boolean":
        return true;
      case "DateTime":
        return this.exampleByField("datetime");
      case "datetime":
        return this.exampleByField("datetime");
      case "date":
        return this.exampleByField("date");
      case "object":
        return {};
      default:
        return null;
    }
  }

  exampleByField(field, type: string = "") {
    const ex = {
      datetime: "2021-03-23T16:13:08.489+01:00",
      DateTime: "2021-03-23T16:13:08.489+01:00",
      date: "2021-03-23",
      title: "Lorem Ipsum",
      year: 2023,
      description: "Lorem ipsum dolor sit amet",
      name: "John Doe",
      full_name: "John Doe",
      first_name: "John",
      last_name: "Doe",
      email: "johndoe@example.com",
      address: "1028 Farland Street",
      street: "1028 Farland Street",
      country: "United States of America",
      country_code: "US",
      zip: 60617,
      city: "Chicago",
      password: "S3cur3P4s5word!",
      password_confirmation: "S3cur3P4s5word!",
      lat: 41.705,
      long: -87.475,
      price: 10.5,
      avatar: "https://example.com/avatar.png",
      url: "https://example.com",
    };
    if (typeof ex[field] !== "undefined") {
      return ex[field];
    }
    if (typeof ex[snakeCase(field)] !== "undefined") {
      return ex[snakeCase(field)];
    }
    return null;
  }

  getPaginatedData(line: string): { dataName: string; metaName: string } {
    const match = line.match(/<.*>\.paginated\((.*)\)/);
    if (!match) {
      return { dataName: "data", metaName: "meta" };
    }

    const params = match[1].split(",").map((s) => s.trim());
    const dataName = params[0] || "data";
    const metaName = params[1] || "meta";

    return { dataName, metaName };
  }

  generateCustomSchema(baseSchema: string, inc: string, exc: string, only: string, appendObj: any = {}) {
    if (!this.schemas[baseSchema]) {
      return null;
    }

    const originalSchema = this.schemas[baseSchema];
    const customSchema = {
      type: originalSchema.type || "object",
      description: `Custom schema for ${baseSchema}`,
      properties: {},
      required: []
    };

    const include = inc.toString().split(",").filter(Boolean);
    const exclude = exc.toString().split(",").filter(Boolean);
    const onlyFields = only.toString().split(",").filter(Boolean);

    // Start with original properties
    if (originalSchema.properties) {
      // If only is specified, use only those fields
      if (onlyFields.length > 0) {
        for (const field of onlyFields) {
          if (originalSchema.properties[field]) {
            customSchema.properties[field] = originalSchema.properties[field];
            if (originalSchema.required && originalSchema.required.includes(field)) {
              customSchema.required.push(field);
            }
          }
        }
      } else {
        // Otherwise, include all fields except excluded ones
        for (const [key, value] of Object.entries(originalSchema.properties)) {
          // Skip excluded fields
          if (exclude.includes(key)) continue;
          
          // Skip passwords unless explicitly included
          if (key === "password" && !include.includes("password")) continue;
          if (key === "password_confirmation" && !include.includes("password_confirmation")) continue;
          
          // Skip timestamps if excluded
          if ((key === "created_at" || key === "updated_at" || key === "deleted_at") && exclude.includes("timestamps")) continue;
          
          // Check if it's a relation that should be included
          const isRelation = value["$ref"] || (value["items"] && value["items"]["$ref"]);
          if (isRelation && !include.includes("relations") && !include.includes(key)) continue;
          
          customSchema.properties[key] = value;
          if (originalSchema.required && originalSchema.required.includes(key)) {
            customSchema.required.push(key);
          }
        }
      }
    }

    // Add appended properties
    for (const [key, value] of Object.entries(appendObj)) {
      if (typeof value === "string") {
        // Simple type like "string"
        customSchema.properties[key] = {
          type: value,
          example: this.exampleByField(key) || `example ${value}`
        };
      } else {
        // Complex object
        customSchema.properties[key] = value;
      }
    }

    // If no properties were added, return null
    if (Object.keys(customSchema.properties).length === 0) {
      return null;
    }

    return customSchema;
  }

}

export abstract class ExampleInterfaces {
  public static paginationInterface() {
    return {
      PaginationMeta: {
        type: "object",
        properties: {
          total: { type: "number", example: 100, nullable: false },
          page: { type: "number", example: 2, nullable: false },
          perPage: { type: "number", example: 10, nullable: false },
          currentPage: { type: "number", example: 3, nullable: false },
          lastPage: { type: "number", example: 10, nullable: false },
          firstPage: { type: "number", example: 1, nullable: false },
          lastPageUrl: {
            type: "string",
            example: "/?page=10",
            nullable: false,
          },
          firstPageUrl: {
            type: "string",
            example: "/?page=1",
            nullable: false,
          },
          nextPageUrl: { type: "string", example: "/?page=6", nullable: false },
          previousPageUrl: {
            type: "string",
            example: "/?page=5",
            nullable: false,
          },
        },
      },
    };
  }
}
