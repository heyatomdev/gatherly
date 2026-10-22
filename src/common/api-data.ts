import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';

type Model = Type<unknown> | [Type<unknown>];

// `TransformInterceptor` wraps every non-paginated body in `{ data }`: document
// that, not the bare DTO. Lists built with `paginate()` keep `ApiPaginatedResponse`.
function dataSchema(model: Model) {
  const item = Array.isArray(model) ? model[0] : model;
  const ref = { $ref: getSchemaPath(item) };
  return {
    item,
    schema: {
      type: 'object' as const,
      required: ['data'],
      properties: {
        data: Array.isArray(model)
          ? { type: 'array' as const, items: ref }
          : ref,
      },
    },
  };
}

/** 200 with `{ data: Model }`, or `{ data: Model[] }` for `[Model]`. */
export function ApiOkData(model: Model, description?: string) {
  const { item, schema } = dataSchema(model);
  return applyDecorators(
    ApiExtraModels(item),
    ApiOkResponse({ schema, description }),
  );
}

/** 201 with `{ data: Model }`. */
export function ApiCreatedData(model: Model, description?: string) {
  const { item, schema } = dataSchema(model);
  return applyDecorators(
    ApiExtraModels(item),
    ApiCreatedResponse({ schema, description }),
  );
}
