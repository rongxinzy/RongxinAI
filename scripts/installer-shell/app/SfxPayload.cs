using System.Buffers.Binary;

namespace ZhiYuan.Setup.Shell;

/// <summary>Locates the signed payload through the PE certificate directory,
/// never by scanning certificates for attacker-controlled trailer bytes.</summary>
internal static class SfxPayload
{
    internal static (long Offset, long Length) Locate(Stream stream)
    {
        using var reader = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true);
        if (stream.Length < 64 || reader.ReadUInt16() != 0x5a4d) throw Invalid();
        stream.Position = 0x3c;
        var pe = reader.ReadUInt32();
        if (pe < 64 || pe > stream.Length - 24) throw Invalid();
        stream.Position = pe;
        if (reader.ReadUInt32() != 0x00004550) throw Invalid();
        if (reader.ReadUInt16() != 0x8664) throw Invalid();
        var sectionCount = reader.ReadUInt16();
        stream.Position = pe + 20;
        var optionalSize = reader.ReadUInt16();
        var optional = pe + 24L;
        stream.Position = optional;
        var magic = reader.ReadUInt16();
        var directories = magic == 0x20b ? 112 : throw Invalid();
        if (optionalSize < directories + 40 || optional + optionalSize > stream.Length) throw Invalid();
        var imageHeadersEnd = optional + optionalSize + sectionCount * 40L;
        if (imageHeadersEnd > stream.Length) throw Invalid();
        stream.Position = optional + directories - 4;
        if (reader.ReadUInt32() < 5) throw Invalid();
        stream.Position = optional + directories + 32;
        var certificateOffset = reader.ReadUInt32();
        var certificateLength = reader.ReadUInt32();
        long end = stream.Length;
        if (certificateOffset != 0 || certificateLength != 0)
        {
            if (certificateOffset == 0 || certificateLength < 8 || certificateOffset % 8 != 0 ||
                (long)certificateOffset + certificateLength != stream.Length) throw Invalid();
            end = certificateOffset;
            long certificate = certificateOffset;
            while (certificate < stream.Length)
            {
                if (stream.Length - certificate < 8) throw Invalid();
                stream.Position = certificate;
                var size = reader.ReadUInt32();
                if (size < 8 || size > stream.Length - certificate ||
                    reader.ReadUInt16() != 0x200 || reader.ReadUInt16() != 2) throw Invalid();
                certificate += ((long)size + 7) & ~7L;
            }
            if (certificate != stream.Length) throw Invalid();
        }
        if (end % 8 != 0 || end < imageHeadersEnd + 24) throw Invalid();
        stream.Position = end - 24;
        var footer = reader.ReadBytes(24);
        if (!footer.AsSpan(20).SequenceEqual("ZYP2"u8) ||
            BinaryPrimitives.ReadUInt32LittleEndian(footer.AsSpan(16)) != 24) throw Invalid();
        var offset = BinaryPrimitives.ReadUInt64LittleEndian(footer);
        var length = BinaryPrimitives.ReadUInt64LittleEndian(footer.AsSpan(8));
        if (offset < (ulong)imageHeadersEnd || offset > (ulong)(end - 24) ||
            length < 22 || length > (ulong)(end - 24) - offset) throw Invalid();
        var padding = (ulong)(end - 24) - offset - length;
        if (padding > 7) throw Invalid();
        stream.Position = (long)(offset + length);
        for (ulong i = 0; i < padding; i++) if (reader.ReadByte() != 0) throw Invalid();
        stream.Position = (long)offset;
        var zipMagic = reader.ReadUInt32();
        if (zipMagic != 0x04034b50 && zipMagic != 0x06054b50) throw Invalid();
        return ((long)offset, (long)length);
    }

    private static EngineException Invalid() => new("安装程序载荷或签名目录损坏，请重新下载安装包。");
}
