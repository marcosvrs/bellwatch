export const defined = <T>(value: T | undefined, label = "Expected a defined value"): T => {
  if (value === undefined) {
    throw new Error(label);
  }
  return value;
};
