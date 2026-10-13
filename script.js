document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('gh-token');
  const repoInput = document.getElementById('gh-repo');
  const slugInput = document.getElementById('project-slug');
  const dropZone = document.getElementById('drop-zone');
  const folderInput = document.getElementById('folder-input');
  const multiFileInput = document.getElementById('multi-file-input');
  const btnSelectFolder = document.getElementById('btn-select-folder');
  const btnSelectFiles = document.getElementById('btn-select-files');
  const fileManifest = document.getElementById('file-manifest');
  const publishBtn = document.getElementById('publish-btn');
  const outputSection = document.getElementById('output-section');
  const outputUrl = document.getElementById('output-url');
  const copyBtn = document.getElementById('copy-btn');
  const openBtn = document.getElementById('open-btn');

  let selectedFiles = [];

  // Restore saved credentials from localStorage
  const savedToken = localStorage.getItem('hoster_gh_token');
  const savedRepo = localStorage.getItem('hoster_gh_repo');
  if (savedToken && tokenInput) tokenInput.value = savedToken;
  if (savedRepo && repoInput) repoInput.value = savedRepo;

  // File Picker Trigger Handlers
  if (btnSelectFolder && folderInput) {
    btnSelectFolder.addEventListener('click', (e) => {
      e.stopPropagation();
      folderInput.click();
    });
  }

  if (btnSelectFiles && multiFileInput) {
    btnSelectFiles.addEventListener('click', (e) => {
      e.stopPropagation();
      multiFileInput.click();
    });
  }

  if (dropZone && multiFileInput) {
    dropZone.addEventListener('click', () => multiFileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  if (folderInput) {
    folderInput.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  if (multiFileInput) {
    multiFileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  function handleFiles(files) {
    selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;

    fileManifest.innerHTML = '';
    fileManifest.style.display = 'block';

    selectedFiles.forEach((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const row = document.createElement('div');
      row.className = 'file-item';
      row.innerHTML = `<span>${relativePath}</span><span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>`;
      fileManifest.appendChild(row);
    });

    // Auto-generate project slug if empty
    if (!slugInput.value.trim()) {
      const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name;
      const rootFolderName = firstPath.includes('/')
        ? firstPath.split('/')[0]
        : firstPath.replace(/\.[^/.]+$/, '');
      slugInput.value = rootFolderName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    }

    publishBtn.disabled = false;
  }

  // Convert File blob to Base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Deployment Flow
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      const rawRepo = repoInput.value.trim();
      const rawSlug = slugInput.value.trim();

      if (!token) {
        alert('Please enter your GitHub Personal Access Token.');
        tokenInput.focus();
        return;
      }

      if (!rawRepo) {
        alert('Please enter the target repository name.');
        repoInput.focus();
        return;
      }

      if (!rawSlug) {
        alert('Please enter a project slug/name.');
        slugInput.focus();
        return;
      }

      if (!selectedFiles.length) {
        alert('No files selected.');
        return;
      }

      const repoName = rawRepo.replace(/\.git$/i, '').trim();
      const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

      // Cache settings locally
      localStorage.setItem('hoster_gh_token', token);
      localStorage.setItem('hoster_gh_repo', repoName);

      publishBtn.disabled = true;
      publishBtn.textContent = 'Verifying token & user...';

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      };

      try {
        // Step 1: Resolve authenticated username
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (!userRes.ok) {
          throw new Error('Invalid token. Please check that your token has "repo" scope enabled.');
        }
        const userData = await userRes.json();
        const username = userData.login;

        // Step 2: Check target repository & branch
        publishBtn.textContent = `Connecting to ${username}/${repoName}...`;
        const repoRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, { headers });
        if (repoRes.status === 404) {
          throw new Error(`Repository "${repoName}" not found under user "${username}". Please create it on GitHub first.`);
        }
        if (!repoRes.ok) {
          throw new Error(`Failed to access repository: ${repoRes.statusText}`);
        }
        const repoData = await repoRes.json();
        const defaultBranch = repoData.default_branch || 'main';

        const refRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/ref/heads/${defaultBranch}`, { headers });
        if (!refRes.ok) {
          throw new Error(`Could not locate branch "${defaultBranch}". Make sure the repo has an initial commit (e.g., a README).`);
        }
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        // Step 3: Upload files as Blobs
        publishBtn.textContent = `Uploading ${selectedFiles.length} file(s)...`;
        const treeItems = [];

        for (const file of selectedFiles) {
          let cleanPath = file.webkitRelativePath || file.name;
          if (cleanPath.includes('/')) {
            cleanPath = cleanPath.substring(cleanPath.indexOf('/') + 1);
          }

          const b64 = await fileToBase64(file);

          const blobRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/blobs`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ content: b64, encoding: 'base64' })
          });

          if (!blobRes.ok) {
            throw new Error(`Failed to upload asset: ${cleanPath}`);
          }
          const blobData = await blobRes.json();

          treeItems.push({
            path: `p/${slug}/${cleanPath}`,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
          });
        }

        // Step 4: Assemble Tree
        publishBtn.textContent = 'Assembling file tree...';
        const treeRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base_tree: latestCommitSha,
            tree: treeItems
          })
        });

        if (!treeRes.ok) {
          throw new Error('Failed to generate git tree.');
        }
        const treeData = await treeRes.json();

        // Step 5: Create Commit
        publishBtn.textContent = 'Committing changes...';
        const commitRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message: `Deploy bundle for ${slug} via Hoster`,
            tree: treeData.sha,
            parents: [latestCommitSha]
          })
        });

        if (!commitRes.ok) {
          throw new Error('Failed to create commit.');
        }
        const commitData = await commitRes.json();

        // Step 6: Update Branch Reference
        publishBtn.textContent = 'Updating repository branch...';
        const patchRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${defaultBranch}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: commitData.sha })
        });

        if (!patchRes.ok) {
          throw new Error('Failed to update branch pointer.');
        }

        // Step 7: Auto-enable GitHub Pages if not already active
        publishBtn.textContent = 'Checking GitHub Pages status...';
        try {
          const pagesCheck = await fetch(`https://api.github.com/repos/${username}/${repoName}/pages`, { headers });
          if (pagesCheck.status === 404) {
            publishBtn.textContent = 'Enabling GitHub Pages automatically...';
            await fetch(`https://api.github.com/repos/${username}/${repoName}/pages`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                source: {
                  branch: defaultBranch,
                  path: '/'
                }
              })
            });
          }
        } catch (pagesErr) {
          console.warn('Could not auto-enable GitHub Pages:', pagesErr);
        }

        // Final URL Output
        const finalUrl = `https://${username}.github.io/${repoName}/p/${slug}/`;
        outputUrl.value = finalUrl;
        outputSection.style.display = 'block';

      } catch (err) {
        alert('Deployment Error: ' + err.message);
      } finally {
        publishBtn.disabled = false;
        publishBtn.textContent = 'Deploy Complete Site';
      }
    });
  }

  // Copy button
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!outputUrl.value) return;
      outputUrl.select();
      navigator.clipboard.writeText(outputUrl.value);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  }

  // Open button
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (outputUrl.value) {
        window.open(outputUrl.value, '_blank');
      }
    });
  }
});