import type { Types } from 'mongoose';

type PersistedPlanInstance = {
  _id: Types.ObjectId | string;
  __v?: unknown;
  [key: string]: unknown;
};

/** Keep Mongo implementation fields out of public API responses. */
export function toPublicPlanInstance(instance: PersistedPlanInstance) {
  const { _id, __v: _version, ...publicInstance } = instance;
  return {
    ...publicInstance,
    id: _id.toString(),
  };
}
