export class ProoflyLogo extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  private getSize(): string {
    return this.getAttribute('size') || '48';
  }

  private getStyles(): string {
    return `
      :host {
        display: inline-block;
        line-height: 0;
      }

      svg {
        display: block;
        width: 100%;
        height: 100%;
      }
    `;
  }

  private render(): void {
    const size = this.getSize();
    const aspectRatio = 323 / 355;
    const width = size;
    const height = Math.round(parseInt(size) / aspectRatio);

    this.shadow.innerHTML = `
      <style>${this.getStyles()}</style>
      <svg width="${width}" height="${height}" viewBox="0 0 323 355" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M236.563 27.0415H217.815V272.945H188.603V27.0415H164.187V272.945H134.539V157.405C106.635 156.824 86.7239 149.557 74.8065 135.605C62.8892 121.363 56.9305 100.871 56.9305 74.1295C56.9305 50.2948 63.0345 31.9828 75.2425 19.1935C87.7412 6.11348 108.524 -0.281185 137.591 0.00947803H236.563V27.0415Z" fill="currentColor"/>
        <path d="M224.16 307.411C244.548 295.477 269.791 295.477 290.179 307.411L314.095 321.411C322.675 326.433 325.559 337.459 320.537 346.038C315.515 354.617 304.489 357.501 295.91 352.48L271.993 338.48C262.837 333.12 251.501 333.12 242.345 338.48C221.957 350.414 196.714 350.414 176.326 338.48C167.17 333.12 155.835 333.12 146.679 338.48C126.291 350.414 101.048 350.414 80.6598 338.48C71.5042 333.12 60.168 333.12 51.0124 338.48L27.0954 352.48C18.5161 357.501 7.49041 354.617 2.46842 346.038C-2.55339 337.459 0.330589 326.433 8.90982 321.411L32.8258 307.411C53.2142 295.477 78.4569 295.477 98.8454 307.411C108.001 312.771 119.337 312.771 128.493 307.411C148.881 295.477 174.124 295.477 194.512 307.411C203.668 312.771 215.004 312.771 224.16 307.411Z" fill="#CF4242"/>
      </svg>
    `;
  }

  static get observedAttributes() {
    return ['size'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue && name === 'size') {
      this.render();
    }
  }
}

customElements.define('prfly-logo', ProoflyLogo);
