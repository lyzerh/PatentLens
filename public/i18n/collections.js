export default {
  zh: {
    'collections.manage':'管理集合中的专利','collections.registryOnly':'登记资料','collections.moveTarget':'将 {patentId} 移动到','collections.move':'移动','collections.remove':'移除',
    'collections.moveConfirm':'将 {patentId} 从「{source}」移动到「{target}」？','collections.removeConfirm':'从「{title}」移除 {patentId}？原始文献和全局特征记录仍保留；有人工研究引用时会拒绝。','collections.moved':'专利已移动。',
    'collections.rename':'重命名集合','collections.renamePrompt':'输入新的研究集合名称','collections.invalidTitle':'名称须为 1–120 字。','collections.renamed':'集合已重命名。',
    'collections.delete':'删除集合','collections.deleteConfirm':'删除「{title}」及其中 {count} 篇专利的组织资料、{revisions} 条人工研究修订？原始文献和全局特征记录仍保留。','collections.deleteAgain':'再次确认永久删除研究集合「{title}」？','collections.deleted':'集合已删除。',
    'collections.error.COLLECTION_VERSION_CONFLICT':'集合已被修改；请刷新后重试。','collections.error.COLLECTION_MANUAL_HISTORY_DEPENDENCY':'该专利被人工比较历史引用，不能移除或移动。','collections.error.COLLECTION_TARGET_DUPLICATE':'目标集合已有该专利；请先核对记录版本。','collections.error.COLLECTION_PATENT_NOT_FOUND':'当前集合中没有这篇专利。','collections.error.COLLECTION_NOT_FOUND':'研究集合不存在或已删除。','collections.error.COLLECTION_TITLE_REQUIRED':'请输入集合名称。'
  },
  en: {
    'collections.manage':'Manage patents in this collection','collections.registryOnly':'Registry record','collections.moveTarget':'Move {patentId} to','collections.move':'Move','collections.remove':'Remove',
    'collections.moveConfirm':'Move {patentId} from “{source}” to “{target}”?','collections.removeConfirm':'Remove {patentId} from “{title}”? Source documents and global feature records remain. Manual research references block removal.','collections.moved':'Patent moved.',
    'collections.rename':'Rename collection','collections.renamePrompt':'Enter a new collection name','collections.invalidTitle':'Name must contain 1–120 characters.','collections.renamed':'Collection renamed.',
    'collections.delete':'Delete collection','collections.deleteConfirm':'Delete “{title}” and its organization data for {count} patents and {revisions} manual revisions? Source documents and global features remain.','collections.deleteAgain':'Confirm permanent deletion of “{title}”?','collections.deleted':'Collection deleted.',
    'collections.error.COLLECTION_VERSION_CONFLICT':'Collection changed; refresh and try again.','collections.error.COLLECTION_MANUAL_HISTORY_DEPENDENCY':'This patent is cited by manual comparison history and cannot be moved or removed.','collections.error.COLLECTION_TARGET_DUPLICATE':'The target already contains this patent. Check its record version.','collections.error.COLLECTION_PATENT_NOT_FOUND':'This patent is not in the collection.','collections.error.COLLECTION_NOT_FOUND':'Collection does not exist or was deleted.','collections.error.COLLECTION_TITLE_REQUIRED':'Enter a collection name.'
  }
};
