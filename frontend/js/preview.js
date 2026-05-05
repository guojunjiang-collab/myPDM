/**
 * 文件预览页面逻辑
 * 支持 PDF 预览（目录/缩放/连续滚动）和 STP 三维预览
 */
var Preview = {
  attId: null,
  token: null,
  fileType: null,
  // PDF state
  pdfDoc: null,
  pdfTotal: 0,
  pdfScale: 1.5,
  pdfOutline: null,
  outlineOpen: false,
  renderedPages: [],
  // 3D state
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  model: null,
  wireframe: false,

  init: function() {
    var params = new URLSearchParams(window.location.search);
    this.attId = params.get('att_id');
    this.token = params.get('token');
    this.fileType = (params.get('type') || '').toLowerCase();

    if (!this.attId) {
      this.showError('缺少附件 ID');
      return;
    }

    document.title = '文件预览 - PDM系统';

    if (this.fileType === 'pdf') {
      this.loadPDF();
    } else if (this.fileType === 'stp' || this.fileType === 'step') {
      this.loadModel();
    } else {
      this.showError('不支持的文件格式');
    }
  },

  // ===== 通用 =====

  showLoading: function(msg) {
    document.getElementById('loading-overlay').style.display = 'flex';
    if (msg) document.getElementById('loading-text').textContent = msg;
  },

  hideLoading: function() {
    document.getElementById('loading-overlay').style.display = 'none';
  },

  showError: function(msg) {
    this.hideLoading();
    document.getElementById('error-msg').textContent = msg;
    document.getElementById('error-overlay').style.display = 'flex';
  },

  showToolbar: function(title, centerHtml) {
    document.getElementById('toolbar-title').textContent = title || '文件预览';
    document.getElementById('toolbar-center').innerHTML = centerHtml || '';
    document.getElementById('toolbar').style.display = 'flex';
  },

  getHeaders: function() {
    return { 'Authorization': 'Bearer ' + this.token };
  },

  // ===== PDF 预览 =====

  loadPDF: function() {
    var self = this;
    self.showLoading('正在加载 PDF，请稍候...');

    // 获取文件并使用浏览器原生 PDF 阅读器
    fetch('/api/v2/attachments/' + self.attId + '/stream', {
      headers: self.getHeaders(),
    }).then(function(response) {
      if (!response.ok) throw new Error('文件加载失败 (' + response.status + ')');
      return response.blob();
    }).then(function(blob) {
      self.hideLoading();
      // 创建 blob URL 并直接显示（浏览器会用原生 PDF 阅读器）
      var url = URL.createObjectURL(blob);
      window.location.replace(url);
    }).catch(function(e) {
      self.showError(e.message);
    });
  },

  // ----- 连续滚动 -----

  renderAllPages: function() {
    var self = this;
    var container = document.getElementById('pdf-viewer');
    container.innerHTML = '';
    self.renderedPages = [];

    var promises = [];
    for (var i = 1; i <= self.pdfTotal; i++) {
      promises.push(self.renderSinglePage(i, container));
    }

    Promise.all(promises).then(function() {
      // 绑定滚动事件，更新页码
      container.addEventListener('scroll', function() {
        self.updatePageIndicator(container);
      });
    });
  },

  renderSinglePage: function(num, container) {
    var self = this;
    return self.pdfDoc.getPage(num).then(function(page) {
      var viewport = page.getViewport({ scale: self.pdfScale });
      var canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.dataset.pageNum = num;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      container.appendChild(canvas);
      self.renderedPages.push({ num: num, canvas: canvas, page: page });

      var ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: viewport }).promise;
    });
  },

  updatePageIndicator: function(container) {
    var scrollTop = container.scrollTop + container.clientHeight / 3;
    var currentPage = 1;
    for (var i = 0; i < self.renderedPages.length; i++) {
      var entry = self.renderedPages[i];
      if (scrollTop >= entry.canvas.offsetTop) {
        currentPage = entry.num;
      }
    }
    document.getElementById('page-indicator-text').textContent = '第 ' + currentPage + ' 页 / 共 ' + this.pdfTotal + ' 页';
  },

  // ----- 缩放 -----

  reRenderAll: function() {
    var self = this;
    var container = document.getElementById('pdf-viewer');
    // 记住当前滚动位置对应的页码
    var scrollTop = container.scrollTop + container.clientHeight / 3;
    var currentPage = 1;
    for (var i = 0; i < self.renderedPages.length; i++) {
      if (scrollTop >= self.renderedPages[i].canvas.offsetTop) {
        currentPage = self.renderedPages[i].num;
      }
    }

    container.innerHTML = '';
    self.renderedPages = [];

    var promises = [];
    for (var j = 1; j <= self.pdfTotal; j++) {
      promises.push(self.renderSinglePage(j, container));
    }

    Promise.all(promises).then(function() {
      // 恢复滚动到之前页码位置
      if (self.renderedPages.length > 0) {
        var target = self.renderedPages[currentPage - 1];
        if (target) {
          container.scrollTop = target.canvas.offsetTop - container.clientHeight / 3;
        }
      }
      document.getElementById('zoom-level').textContent = Math.round(self.pdfScale / 1.5 * 100) + '%';
    });
  },

  zoomIn: function() {
    if (this.pdfScale < 4) {
      this.pdfScale = Math.min(4, this.pdfScale + 0.25);
      this.reRenderAll();
    }
  },

  zoomOut: function() {
    if (this.pdfScale > 0.5) {
      this.pdfScale = Math.max(0.5, this.pdfScale - 0.25);
      this.reRenderAll();
    }
  },

  zoomFit: function() {
    var container = document.getElementById('pdf-viewer');
    if (this.pdfDoc && this.pdfDoc.numPages > 0) {
      var self = this;
      this.pdfDoc.getPage(1).then(function(page) {
        var baseViewport = page.getViewport({ scale: 1 });
        var containerWidth = container.clientWidth - 48; // padding
        var fitScale = containerWidth / baseViewport.width;
        self.pdfScale = Math.max(0.5, Math.min(4, fitScale));
        self.reRenderAll();
      });
    }
  },

  // ----- 目录 -----

  loadOutline: function() {
    var self = this;
    self.pdfDoc.getOutline().then(function(outline) {
      self.pdfOutline = outline;
      if (outline && outline.length > 0) {
        // 显示目录按钮激活状态
        document.getElementById('outline-toggle-btn').classList.add('active');
        self.renderOutline(outline);
      }
    }).catch(function() {
      // 目录加载失败，静默忽略
    });
  },

  renderOutline: function(items, container, level) {
    var self = this;
    level = level || 0;
    container = container || document.getElementById('outline-list');

    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'outline-item' + (level > 0 ? ' level-' + level : '');
      div.textContent = item.title;
      div.title = item.title;
      div.onclick = function() {
        self.goToOutlineDest(item.dest);
      };
      container.appendChild(div);

      if (item.items && item.items.length > 0) {
        self.renderOutline(item.items, container, level + 1);
      }
    });
  },

  goToOutlineDest: function(dest) {
    if (!dest) return;
    var self = this;

    // dest 可能是 string (named dest) 或 array (explicit dest)
    var promise;
    if (typeof dest === 'string') {
      promise = self.pdfDoc.getDestination(dest);
    } else {
      promise = Promise.resolve(dest);
    }

    promise.then(function(destArray) {
      if (!destArray || destArray.length < 2) return;
      var pageNum = destArray[0]; // 1-based page index
      if (pageNum < 1 || pageNum > self.pdfTotal) return;

      var container = document.getElementById('pdf-viewer');
      var targetEntry = self.renderedPages[pageNum - 1];
      if (targetEntry) {
        container.scrollTop = targetEntry.canvas.offsetTop;
      }
    }).catch(function() {});
  },

  toggleOutline: function() {
    this.outlineOpen = !this.outlineOpen;
    var sidebar = document.getElementById('pdf-outline');
    var viewer = document.getElementById('pdf-viewer');
    var btn = document.getElementById('outline-toggle-btn');

    if (this.outlineOpen) {
      sidebar.style.display = 'flex';
      sidebar.classList.remove('hidden');
      viewer.classList.add('with-outline');
      btn.classList.add('active');
    } else {
      sidebar.classList.add('hidden');
      viewer.classList.remove('with-outline');
      btn.classList.remove('active');
      // 等动画结束后隐藏
      setTimeout(function() {
        if (!Preview.outlineOpen) sidebar.style.display = 'none';
      }, 200);
    }
  },

  // ===== 3D 模型预览 =====

  loadModel: function() {
    var self = this;
    self.showLoading('正在加载三维模型...');

    fetch('/api/v2/attachments/' + self.attId + '/gltf', {
      headers: self.getHeaders(),
    }).then(function(response) {
      if (!response.ok) throw new Error('模型加载失败 (' + response.status + ')');
      return response.arrayBuffer();
    }).then(function(buffer) {
      self.hideLoading();
      self.initThreeScene();
      self.showToolbar('三维模型预览');
      document.getElementById('model-viewer').style.display = 'block';
      document.getElementById('model-controls').style.display = 'flex';

      var loader = new THREE.GLTFLoader();
      loader.parse(buffer, '', function(gltf) {
        self.model = gltf.scene;
        var box = new THREE.Box3().setFromObject(gltf.scene);
        var center = box.getCenter(new THREE.Vector3());
        var size = box.getSize(new THREE.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          var scale = 5 / maxDim;
          gltf.scene.scale.setScalar(scale);
          box = new THREE.Box3().setFromObject(gltf.scene);
          center = box.getCenter(new THREE.Vector3());
          gltf.scene.position.sub(center);
        }
        self.scene.add(gltf.scene);
        var dist = Math.max(size.x, size.y, size.z) * 2;
        self.camera.position.set(dist, dist * 0.7, dist);
        self.camera.lookAt(0, 0, 0);
        self.controls.target.set(0, 0, 0);
        self.controls.update();
      }, function() {
        self.showError('模型解析失败');
      });
    }).catch(function(e) {
      self.showError(e.message);
    });
  },

  initThreeScene: function() {
    var canvas = document.getElementById('model-canvas');
    var width = canvas.parentElement.clientWidth;
    var height = canvas.parentElement.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(5, 3, 5);

    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    var dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 7);
    this.scene.add(dir1);

    var dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-5, 5, -5);
    this.scene.add(dir2);

    var grid = new THREE.GridHelper(20, 20, 0x333355, 0x222244);
    grid.position.y = -0.01;
    this.scene.add(grid);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    var self = this;
    window.addEventListener('resize', function() {
      var w = canvas.parentElement.clientWidth;
      var h = canvas.parentElement.clientHeight;
      self.camera.aspect = w / h;
      self.camera.updateProjectionMatrix();
      self.renderer.setSize(w, h);
    });

    function animate() {
      requestAnimationFrame(animate);
      self.controls.update();
      self.renderer.render(self.scene, self.camera);
    }
    animate();
  },

  resetCamera: function() {
    if (!this.model) return;
    var box = new THREE.Box3().setFromObject(this.model);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var dist = Math.max(size.x, size.y, size.z) * 2;
    this.camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
    this.controls.target.copy(center);
    this.controls.update();
  },

  toggleWireframe: function() {
    this.wireframe = !this.wireframe;
    var btn = document.getElementById('wireframe-btn');
    if (btn) btn.textContent = this.wireframe ? '🔲 实体' : '🔲 线框';
    if (!this.model) return;
    this.model.traverse(function(child) {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(function(m) { m.wireframe = Preview.wireframe; });
        } else {
          child.material.wireframe = Preview.wireframe;
        }
      }
    });
  },

  // ===== 通用操作 =====

  download: function() {
    var self = this;
    fetch('/api/v2/attachments/' + self.attId + '/stream', {
      headers: self.getHeaders(),
    }).then(function(response) {
      if (!response.ok) throw new Error('下载失败');
      return response.blob();
    }).then(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(function(e) {
      alert('下载失败: ' + e.message);
    });
  },

  close: function() {
    window.close();
  },
};

document.addEventListener('DOMContentLoaded', function() {
  Preview.init();
});
