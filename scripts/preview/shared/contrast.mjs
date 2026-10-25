export async function contrast(locator) {
  return locator.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (front, back) =>
      front.map((value, index) =>
        index === 3 ? 255 : (value * front[3]) / 255 + back[index] * (1 - front[3] / 255),
      );
    const luminance = color => {
      const linear = color.slice(0, 3).map(value => {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const ratio = (a, b) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      ancestors.unshift(parent);
    const outside = ancestors.reduce(
      (back, ancestor) => over(rgba(getComputedStyle(ancestor).backgroundColor), back),
      [255, 255, 255, 255],
    );
    const style = getComputedStyle(element);
    const inside = over(rgba(style.backgroundColor), outside);
    const border = over(rgba(style.borderColor), inside);
    return {
      text: ratio(over(rgba(style.color), inside), inside),
      border: Math.min(ratio(border, outside), ratio(border, inside)),
      focus: ratio(over(rgba(style.outlineColor), outside), outside),
      focusVisible: element.matches(':focus-visible'),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      outlineOffset: style.outlineOffset,
    };
  });
}
