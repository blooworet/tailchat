type ObjectIdLike = { toString(): string };

export default function virtualId<T extends { _id: string | ObjectIdLike }>(
  arr: T[]
): Array<T & { id: string }>;
export default function virtualId<T extends { _id: string | ObjectIdLike }>(
  doc: T
): T & { id: string };

/** Virtual ID (_id to id) for react-admin */
export default function virtualId<T extends { _id: string | ObjectIdLike }>(
  el: Array<T> | T
) {
  if (Array.isArray(el)) {
    return el.map((e) => {
      return {
        id:
          typeof e._id === 'string'
            ? e._id
            : (e._id as ObjectIdLike).toString(),
        ...e,
        _id: undefined,
      };
    });
  }

  return {
    id:
      typeof el._id === 'string' ? el._id : (el._id as ObjectIdLike).toString(),
    ...el,
    _id: undefined,
  };
}
