<template>
  <div class="mx-auto max-w-6xl my-4 px-4 relative">
    <loading-overlay :loading="loading" />

    <div class="flex items-center justify-between mb-4">
      <div>
        <div class="text-gray-800 text-lg">管理图片</div>
        <div class="text-sm text-gray-500">
          已上传 {{ totalItems }} 张图片，共 {{ formatBytes(imagesTotalSize) }}
        </div>
      </div>
      <div class="flex items-center justify-start">
        <font-awesome-icon :icon="faFolderPlus" class="text-xl cursor-pointer text-3xl text-amber-300 mr-2" @click="addFolder" />
        <font-awesome-icon
            :icon="faRedoAlt"
            class="text-xl cursor-pointer text-indigo-400"
            @click="listImages"
        />
      </div>
    </div>
    <div class="my-2 flex items-center justify-start flex-wrap">
      <div v-for="it in prefixes" class="px-4 py-2 items-center flex rounded-lg bg-white shadow-md cursor-pointer mx-1" @click="changeFolder(it)">
        <font-awesome-icon :icon="faFolder" class="text-3xl text-amber-500" />
        <span v-if="it !== '/'" class="pl-2 text-gray-600"> {{ it.replace("/", "") }}</span>
        <span v-else class="pl-2 text-gray-600"> {{ it }}</span>
      </div>
    </div>
    <div class="grid gap-2 lg:gap-4 lg:grid-cols-4 grid-cols-2">
      <transition-group name="el-fade-in-linear">
        <div
            class="col-span-1 md:col-span-1"
            v-for="item in uploadedImages"
            :key="item.url"
        >
          <image-box
              :src="item.url"
              :copyUrl="item.copyUrl"
              :name="item.key"
              :size="item.size"
              @delete="deleteImage(item.key)"
              mode="uploaded"
          />
        </div>
      </transition-group>
    </div>

    <!-- 分页控件 -->
    <div class="mt-4 flex justify-center">
      <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="totalItems"
          @current-change="handlePageChange"
          layout="prev, pager, next"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { requestListImages, requestDeleteImage, createFolder } from '../utils/request'
import LoadingOverlay from '../components/LoadingOverlay.vue'
import formatBytes from '../utils/format-bytes'
import { computed, onMounted, ref, watch } from 'vue'
import type { ImgItem, ImgReq, Folder } from '../utils/types'
import ImageBox from '../components/ImageBox.vue'
import { ElMessageBox, ElMessage, ElPagination } from 'element-plus'
import { faRedoAlt, faFolder, faFolderPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"

const loading = ref(false)
const delimiter = ref('/')
const uploadedImages = ref<ImgItem[]>([])
const prefixes = ref<String[]>([])
const imagesTotalSize = computed(() =>
    uploadedImages.value.reduce((total, item) => total + item.size, 0)
)

// 新增的分页相关变量
const currentPage = ref(1)
const pageSize = ref(100)
const totalItems = ref(0)
const totalPages = ref(0)

const changeFolder = (path: string) => {
  console.log(path)
  delimiter.value = path
  currentPage.value = 1 // 重置页码
  listImages()
}

const addFolder = () => {
  ElMessageBox.prompt('请输入目录名称，仅支持英文名称', '新增目录', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputPattern: /^[A-Za-z_]+$/,
    inputErrorMessage: '无效的目录名称',
  }).then(({ value }) => {
    loading.value = true
    createFolder(<Folder>{
      name: value
    }).then((res) => {
      console.log(res)
      ElMessage.success('文件夹创建成功')
      listImages()
    }).catch(() => {
      ElMessage.error('文件夹创建失败')
    }).finally(() => {
      loading.value = false
    })
  }).catch(() => {})
}

const listImages = () => {
  loading.value = true
  requestListImages(<ImgReq>{
    limit: pageSize.value,
    delimiter: delimiter.value,
    page: currentPage.value
  }).then((data) => {
    uploadedImages.value = data.list
    totalItems.value = data.totalItems
    totalPages.value = data.totalPages
    if (data.prefixes && data.prefixes.length) {
      prefixes.value = data.prefixes
      if (delimiter.value !== '/') {
        prefixes.value = ['/', ...data.prefixes]
      }
    } else {
      prefixes.value = ['/']
    }
  }).catch(() => {})
      .finally(() => {
        loading.value = false
      })
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  listImages()
}

onMounted(() => {
  listImages()
})

const deleteImage = (src: string) => {
  requestDeleteImage({
    keys: src
  }).then((res) => {
    uploadedImages.value = uploadedImages.value.filter((item) => item.key !== res)
    // 可能需要重新加载当前页或更新总数
    listImages()
  })
}

// 监听 delimiter 变化，重置页码
watch(delimiter, () => {
  currentPage.value = 1
})
</script>
