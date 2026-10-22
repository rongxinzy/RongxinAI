namespace ZhiYuan.Setup.Shell;

/// <summary>
/// Pure sizing math for the borderless setup window.
///
/// The panel is designed at 860x560 logical pixels. Laptop panels report far less
/// than that after display scaling (1280x720 at 150% leaves ~853x480), and a
/// window larger than the work area gets clamped by Windows, which cuts content
/// and adds inner scrollbars. Fitting the client area keeps the UI one panel; the
/// page's height media queries compact the layout down to these minimums.
/// </summary>
internal static class WindowFit
{
    internal const int DesignWidth = 860;
    internal const int DesignHeight = 560;
    internal const int MinWidth = 600;
    internal const int MinHeight = 400;
    internal const int EdgeMargin = 32;
    private const int AbsoluteFloor = 320;

    /// <summary>
    /// Client size in logical pixels for a work area given in physical pixels and
    /// the window's DPI scale (96 dpi => 1.0). Never exceeds the work area, even
    /// when the panel is smaller than the supported minimum.
    /// </summary>
    internal static (int Width, int Height) Fit(
        int workAreaWidth,
        int workAreaHeight,
        float dpiScale)
    {
        var scale = dpiScale > 0f ? dpiScale : 1f;
        var availableWidth = (int)Math.Floor(workAreaWidth / scale) - EdgeMargin;
        var availableHeight = (int)Math.Floor(workAreaHeight / scale) - EdgeMargin;
        return (
            ClampToDesign(DesignWidth, MinWidth, availableWidth),
            ClampToDesign(DesignHeight, MinHeight, availableHeight));
    }

    private static int ClampToDesign(int design, int minimum, int available) =>
        Math.Min(design, available >= minimum ? available : Math.Max(AbsoluteFloor, available));
}
