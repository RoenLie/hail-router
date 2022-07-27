export const clone = <T>(value: T) => deepClone(value) as T;


// Do not export this! If you want to, you should make a strongly typed wrapper function.
// This internal implementation is not strongly typed because it does very dynamic things.
const deepClone = (value: any) => {
	if (typeof value !== 'object' || value === null)
		return value;

	let clone: any;

	if (value instanceof Array) {
		clone = value.map(deepClone);
	}
	else if (value instanceof Date) {
		clone = new Date(value);
	}
	else {
		clone = {};
		for (const p in value)
			clone[p] = deepClone(value[p]);
	}

	return clone;
};
