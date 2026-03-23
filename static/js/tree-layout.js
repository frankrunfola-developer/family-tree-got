// clean family-unit layout engine

export function buildTree(data) {
  return data.generations.map(gen => {
    return gen.families.map(fam => ({
      parents: fam.parents,
      children: fam.children
    }));
  });
}
