/**
 * Disposable resource tracker. Every geometry/material/texture created for the
 * scene is registered here so `dispose()` can release GPU memory
 * deterministically — TASK-001 acceptance criterion 4 (no leaks).
 */
export class Disposer {
  private readonly geometries = new Set<import('three').BufferGeometry>();
  private readonly materials = new Set<import('three').Material>();
  private readonly textures = new Set<import('three').Texture>();

  track<T extends import('three').BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  trackMaterial<T extends import('three').Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  trackTexture<T extends import('three').Texture>(texture: T): T {
    this.textures.add(texture);
    return texture;
  }

  /** Releases everything registered, including resources found by traversal. */
  dispose(root?: import('three').Object3D): void {
    if (root) {
      root.traverse((object) => {
        const mesh = object as Partial<import('three').Mesh>;
        if (mesh.geometry) this.geometries.add(mesh.geometry);
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => this.materials.add(m));
        else if (material) this.materials.add(material);
      });
    }

    this.textures.forEach((texture) => texture.dispose());
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.clear();
    this.geometries.clear();
    this.materials.clear();
  }
}
