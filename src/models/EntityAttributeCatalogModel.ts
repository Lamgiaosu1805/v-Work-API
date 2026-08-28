import mongoose, { Schema, Document } from "mongoose";
import BaseSchema from "./BaseSchema";

export type AttributeType = "string" | "number" | "boolean" | "reference" | "enum";

export interface AttributeDefDoc {
  path: string;
  label: string;
  type: AttributeType;
  options?: string[];
}

export interface FieldDefDoc {
  name: string;
  label: string;
}

export interface EntityAttributeCatalogDoc extends Document {
  entity: string;
  subjectAttributes: AttributeDefDoc[];
  resourceAttributes: AttributeDefDoc[];
  fields: FieldDefDoc[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AttributeDefSchema = new Schema<AttributeDefDoc>(
  {
    path: { type: String, required: true },
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ["string", "number", "boolean", "reference", "enum"],
      required: true
    },
    options: { type: [String], default: undefined }
  },
  { _id: false }
);

const FieldDefSchema = new Schema<FieldDefDoc>(
  {
    name: { type: String, required: true },
    label: { type: String, required: true }
  },
  { _id: false }
);

const EntityAttributeCatalogSchema = new Schema<EntityAttributeCatalogDoc>(
  {
    entity: { type: String, required: true },
    subjectAttributes: { type: [AttributeDefSchema], default: [] },
    resourceAttributes: { type: [AttributeDefSchema], default: [] },
    fields: { type: [FieldDefSchema], default: [] },

    ...BaseSchema.obj
  },
  {
    timestamps: BaseSchema.options.timestamps,
    toJSON: BaseSchema.options.toJSON,
    toObject: BaseSchema.options.toObject
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
);

EntityAttributeCatalogSchema.index(
  { entity: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.model<EntityAttributeCatalogDoc>(
  "entity_attribute_catalog",
  EntityAttributeCatalogSchema
);
