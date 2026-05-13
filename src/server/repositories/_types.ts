// Helpers genéricos para repositories.
// Insert<T, K> = T sin las keys K (típicamente id + timestamps autogestionados).
// Update<T, K> = Partial de T sin las keys K (parcial para PATCH).

export type Insert<T, K extends keyof T = never> = Omit<T, K>;
export type Update<T, K extends keyof T = never> = Partial<Omit<T, K>>;
