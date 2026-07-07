import {
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from 'lucide-react';

// ============================================================
// File extension → type info mapping
// ============================================================

export interface FileTypeInfo {
  icon: typeof FileText;
  color: string;
  label: string;
}

const EXT_MAP: Record<string, FileTypeInfo> = {};

const register = (extensions: string[], info: FileTypeInfo) => {
  for (const ext of extensions) {
    EXT_MAP[ext] = info;
  }
};

// Word
register(['.doc', '.docx'], { icon: FileText, color: 'text-[#2B579A]', label: 'Word' });
// Excel
register(['.xls', '.xlsx', '.csv'], { icon: FileSpreadsheet, color: 'text-[#217346]', label: 'Excel' });
// PPT
register(['.ppt', '.pptx'], { icon: Presentation, color: 'text-[#D24726]', label: 'PPT' });
// PDF
register(['.pdf'], { icon: FileText, color: 'text-[#FF0000]', label: 'PDF' });
// Archive
register(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'], { icon: FileArchive, color: 'text-[#F59E0B]', label: 'Archive' });
// Code
register(['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.sh', '.bat', '.rb', '.php', '.swift', '.kt'], { icon: FileCode2, color: 'text-[#8B5CF6]', label: 'Code' });
// Text / Config
register(['.txt', '.md', '.log', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env', '.gitignore'], { icon: FileText, color: 'text-[#6B7280]', label: 'Text' });
// Audio
register(['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.wma'], { icon: FileAudio, color: 'text-[#EC4899]', label: 'Audio' });
// Video
register(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm'], { icon: FileVideo, color: 'text-[#6366F1]', label: 'Video' });
// Image (fallback — used when thumbnail rendering fails)
register(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif', '.ico', '.avif'], { icon: FileImage, color: 'text-[#3B82F6]', label: 'Image' });

/** Default info for unrecognized file types */
const DEFAULT_FILE_TYPE_INFO: FileTypeInfo = { icon: FileText, color: 'text-[#9CA3AF]', label: 'File' };

/**
 * Get file type icon info from a file name.
 * Extension matching is case-insensitive.
 */
export function getFileTypeInfo(fileName: string): FileTypeInfo {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return DEFAULT_FILE_TYPE_INFO;
  const ext = fileName.slice(dotIndex).toLowerCase();
  return EXT_MAP[ext] || DEFAULT_FILE_TYPE_INFO;
}

// Re-export commonly used icons for direct consumers
export { FileImage as ImageFileIcon };
